import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  isLoomExperimentEvidenceResponse,
  isLoomProjectExperimentsResponse,
  isLoomVeilExperimentRecordedPayload,
  isLoomVeilVerificationStartedPayload,
  type LoomEventEnvelope,
  type LoomExperimentEvidenceResponse,
  type LoomProjectExperimentsResponse,
} from "@veilquant/loom-protocol";
import type { SessionEventStoreRegistry } from "./event-store.js";
import type { LoomProjectRegistry, VeilProjectContext } from "./project-readiness.js";
import { canonicalJson } from "./research-artifacts.js";
import type { VeilExperimentArchive } from "./veil-api.js";

const MAXIMUM_EVIDENCE_BYTES = 128 * 1_024;
const MAXIMUM_HISTORY_BYTES = 256 * 1_024;
const MAXIMUM_PROJECTED_LESSONS = 8;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export interface OwnedExperiment {
  readonly projectId: string;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly experimentId: string;
  readonly archiveHash: string;
  readonly pricingHash: string;
  readonly gateEvaluationHash: string;
  readonly metricsHash: string;
  readonly reproductionHash: string;
}

export class ExperimentAccessError extends Error {
  readonly code: "PROJECT_NOT_READY" | "EXPERIMENT_NOT_FOUND" | "EXPERIMENT_UNAVAILABLE";

  constructor(code: ExperimentAccessError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExperimentAccessError";
    this.code = code;
  }
}

/** Reloads immutable Veil archives only after proving session and attempt ownership. */
export class LoomExperimentCoordinator {
  readonly #eventStores: SessionEventStoreRegistry;
  readonly #projects: LoomProjectRegistry;

  constructor(options: {
    eventStores: SessionEventStoreRegistry;
    projects: LoomProjectRegistry;
  }) {
    this.#eventStores = options.eventStores;
    this.#projects = options.projects;
  }

  async list(projectId: string): Promise<LoomProjectExperimentsResponse> {
    try {
      await this.#projects.root(projectId);
    } catch (error) {
      throw new ExperimentAccessError(
        "PROJECT_NOT_READY",
        "The project is not registered for Experiment history",
        { cause: error },
      );
    }
    let identities: readonly { projectId: string; sessionId: string }[];
    try {
      identities = (await this.#eventStores.discover()).filter(
        (identity) => identity.projectId === projectId,
      );
    } catch (error) {
      throw unavailable("The project Experiment index is unavailable", error);
    }
    const byExperiment = new Map<string, LoomProjectExperimentsResponse["experiments"][number]>();
    for (const identity of identities) {
      let events: readonly LoomEventEnvelope[];
      try {
        events = await (await this.#eventStores.get(projectId, identity.sessionId)).replay();
      } catch {
        continue;
      }
      const creation = events.filter((event) => event.type === "session.created");
      if (
        creation.length !== 1 ||
        creation[0]?.payload.profile !== "veil" ||
        events.some(
          (event) =>
            event.type === "veil.experiment_recorded" &&
            !isLoomVeilExperimentRecordedPayload(event.payload),
        ) ||
        events.some(
          (event) =>
            event.type === "veil.verification_started" &&
            !isLoomVeilVerificationStartedPayload(event.payload),
        )
      ) {
        continue;
      }
      for (const event of events) {
        if (
          event.type !== "veil.experiment_recorded" ||
          !isLoomVeilExperimentRecordedPayload(event.payload) ||
          event.payload.registrationStatus !== "preregistered"
        ) {
          continue;
        }
        const verifications = events.filter(
          (candidate) =>
            candidate.type === "veil.verification_started" &&
            isLoomVeilVerificationStartedPayload(candidate.payload) &&
            candidate.payload.attemptId === event.payload.attemptId &&
            candidate.payload.taskId === event.payload.taskId,
        );
        const terminals = events.filter(
          (candidate) =>
            candidate.payload.taskId === event.payload.taskId &&
            candidate.sequence > event.sequence &&
            ["task.cancelled", "task.completed", "task.failed", "task.interrupted"].includes(
              candidate.type,
            ),
        );
        const verification = verifications[0];
        const terminal = terminals[0];
        if (
          events.filter(
            (candidate) =>
              candidate.type === "veil.experiment_recorded" &&
              isLoomVeilExperimentRecordedPayload(candidate.payload) &&
              candidate.payload.experimentId === event.payload.experimentId,
          ).length !== 1 ||
          verifications.length !== 1 ||
          verification === undefined ||
          !isLoomVeilVerificationStartedPayload(verification.payload) ||
          terminals.length !== 1 ||
          terminal?.type !== "task.completed" ||
          verification.sequence >= event.sequence
        ) {
          continue;
        }
        const summary = {
          sessionId: identity.sessionId,
          attemptId: event.payload.attemptId,
          commandId: verification.payload.commandId,
          taskId: event.payload.taskId,
          sourceSessionId: verification.payload.source.sessionId,
          sourceViewId: verification.payload.source.viewId,
          experimentId: event.payload.experimentId,
          archiveHash: event.payload.archiveHash,
          recordedAt: event.occurredAt,
          hypothesis: verification.payload.hypothesis,
          verdict: event.payload.verdict,
          claimStatus: event.payload.claimStatus,
          registrationStatus: event.payload.registrationStatus,
          executionCount: event.payload.executionCount,
          assurance: event.payload.assurance,
        } as const;
        const current = byExperiment.get(summary.experimentId);
        if (current === undefined || current.recordedAt < summary.recordedAt) {
          byExperiment.set(summary.experimentId, summary);
        }
      }
    }
    const all = [...byExperiment.values()].sort((left, right) =>
      left.recordedAt === right.recordedAt
        ? right.experimentId.localeCompare(left.experimentId)
        : right.recordedAt.localeCompare(left.recordedAt),
    );
    const experiments = all.slice(0, 50);
    while (
      experiments.length > 0 &&
      historyBytes(projectId, all.length, experiments) > MAXIMUM_HISTORY_BYTES
    ) {
      experiments.pop();
    }
    const response = {
      format: "loom.project-experiments.v0",
      projectId,
      totalCount: all.length,
      experiments,
      truncated: all.length > experiments.length,
    } as const;
    if (!isLoomProjectExperimentsResponse(response)) {
      throw unavailable("The project Experiment index failed protocol validation");
    }
    return Object.freeze(response);
  }

  async evidence(input: {
    projectId: string;
    sessionId: string;
    experimentId: string;
  }): Promise<LoomExperimentEvidenceResponse> {
    const resolved = await this.#resolve(input);
    const experiment = resolved.archive.execution.experiment;
    const lessons = experiment.lessons.slice(0, MAXIMUM_PROJECTED_LESSONS);
    const response = {
      format: "loom.experiment-evidence.v0",
      projectId: input.projectId,
      sessionId: input.sessionId,
      attemptId: resolved.record.attemptId,
      experimentId: experiment.experimentId,
      archiveHash: resolved.archive.archiveHash,
      issuedAt: experiment.issuedAt,
      verdict: experiment.verdict,
      claimStatus: experiment.claimStatus,
      registrationStatus: "preregistered",
      hypothesis: {
        ref: experiment.hypothesis.hypothesisRef,
        statement: resolved.verification.hypothesis.statement,
      },
      dataset: {
        id: experiment.dataset.dataset,
        version: experiment.dataset.version,
        declarationHash: experiment.dataset.declarationHash,
        degradations: [...experiment.dataset.degradations],
      },
      pricingMethod: { ...experiment.pricing.method },
      costModel: { ...experiment.pricing.costModel },
      sample: { ...experiment.pricing.sample },
      effectiveTrials: experiment.effectiveTrials,
      metrics: experiment.metrics.map((metric) => ({ ...metric })),
      gates: experiment.gates.map((gate) => ({ ...gate })),
      rationale: experiment.rationale,
      lessons: {
        totalCount: experiment.lessons.length,
        items: lessons,
        truncated: experiment.lessons.length > lessons.length,
      },
      lineage: {
        artifactHash: experiment.artifactHash,
        parameterLockHash: experiment.parameterLockHash,
        planHash: experiment.planHash,
        contractHash: experiment.contractHash,
        candidateHash: experiment.candidateHash,
        pricingHash: experiment.pricingHash,
        gateEvaluationHash: experiment.gateEvaluationHash,
        policyHash: experiment.policyHash,
        ...experiment.pricing.series,
        readSetSnapshotCount: resolved.archive.readSetSnapshotIds.length,
      },
      assurance: resolved.record.assurance,
    } as const;
    if (
      !isLoomExperimentEvidenceResponse(response) ||
      Buffer.byteLength(canonicalJson(response), "utf8") > MAXIMUM_EVIDENCE_BYTES
    ) {
      throw unavailable("The verified Experiment cannot be represented by the supported UI format");
    }
    return Object.freeze(response);
  }

  async prepareReproduction(input: {
    projectId: string;
    sessionId: string;
    experimentId: string;
  }): Promise<OwnedExperiment> {
    const resolved = await this.#resolve(input);
    const experiment = resolved.archive.execution.experiment;
    const metricsHash = veilHash("veil.experiment-metrics.v0", experiment.metrics);
    const reproduction = {
      format: "veil.experiment-reproduction.v0",
      experimentId: experiment.experimentId,
      reproducedExperimentId: experiment.experimentId,
      pricingHash: experiment.pricingHash,
      gateEvaluationHash: experiment.gateEvaluationHash,
      metricsHash,
      status: "matched",
    } as const;
    return Object.freeze({
      projectId: input.projectId,
      sessionId: input.sessionId,
      attemptId: resolved.record.attemptId,
      experimentId: resolved.record.experimentId,
      archiveHash: resolved.record.archiveHash,
      pricingHash: reproduction.pricingHash,
      gateEvaluationHash: reproduction.gateEvaluationHash,
      metricsHash,
      reproductionHash: veilHash("veil.experiment-reproduction.v0", reproduction),
    });
  }

  async #resolve(input: { projectId: string; sessionId: string; experimentId: string }): Promise<{
    context: VeilProjectContext;
    archive: VeilExperimentArchive;
    record: ReturnType<typeof requireExperimentRecord>;
    verification: ReturnType<typeof requireVerificationRecord>;
  }> {
    let context: VeilProjectContext;
    try {
      context = await this.#projects.requireVeilProject(input.projectId);
    } catch (error) {
      throw new ExperimentAccessError(
        "PROJECT_NOT_READY",
        "The project is not ready to inspect Veil evidence",
        { cause: error },
      );
    }
    let events: readonly LoomEventEnvelope[];
    try {
      events = await (await this.#eventStores.get(input.projectId, input.sessionId)).replay();
    } catch (error) {
      throw unavailable("The Experiment session evidence is unavailable", error);
    }
    const creation = events.filter((event) => event.type === "session.created");
    if (creation.length !== 1 || creation[0]?.payload.profile !== "veil") {
      throw notFound();
    }
    if (
      events.some(
        (event) =>
          event.type === "veil.experiment_recorded" &&
          !isLoomVeilExperimentRecordedPayload(event.payload),
      ) ||
      events.some(
        (event) =>
          event.type === "veil.verification_started" &&
          !isLoomVeilVerificationStartedPayload(event.payload),
      )
    ) {
      throw unavailable("The Experiment session contains unsupported evidence");
    }
    const record = requireExperimentRecord(events, input.experimentId);
    const verification = requireVerificationRecord(events, record.attemptId, record.taskId);
    const completed = events.filter(
      (event) =>
        event.type === "task.completed" &&
        event.payload.taskId === record.taskId &&
        event.sequence > record.sequence,
    );
    if (completed.length !== 1 || verification.sequence >= record.sequence) {
      throw unavailable("The Experiment task topology is incomplete");
    }
    let archive: VeilExperimentArchive;
    try {
      archive = await context.veil.api.loadProjectExperiment(context.root, input.experimentId);
    } catch (error) {
      throw unavailable("The immutable Experiment archive could not be verified", error);
    }
    assertArchiveOwnership(archive, record, verification.hypothesis.ref);
    return { context, archive, record, verification };
  }
}

function requireExperimentRecord(
  events: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly payload: Record<string, unknown>;
  }[],
  experimentId: string,
) {
  const matches = events.filter(
    (event) =>
      event.type === "veil.experiment_recorded" &&
      isLoomVeilExperimentRecordedPayload(event.payload) &&
      event.payload.experimentId === experimentId,
  );
  if (matches.length === 0) throw notFound();
  if (matches.length !== 1 || !isLoomVeilExperimentRecordedPayload(matches[0]?.payload)) {
    throw unavailable("The Experiment identity is ambiguous in this session");
  }
  return Object.freeze({ ...matches[0].payload, sequence: matches[0].sequence });
}

function requireVerificationRecord(
  events: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly payload: Record<string, unknown>;
  }[],
  attemptId: string,
  taskId: string,
) {
  const matches = events.filter(
    (event) =>
      event.type === "veil.verification_started" &&
      isLoomVeilVerificationStartedPayload(event.payload) &&
      event.payload.attemptId === attemptId &&
      event.payload.taskId === taskId,
  );
  if (matches.length !== 1 || !isLoomVeilVerificationStartedPayload(matches[0]?.payload)) {
    throw unavailable("The Experiment has no unique verification origin");
  }
  return Object.freeze({ ...matches[0].payload, sequence: matches[0].sequence });
}

function assertArchiveOwnership(
  archive: VeilExperimentArchive,
  record: ReturnType<typeof requireExperimentRecord>,
  hypothesisRef: string,
): void {
  const experiment = archive?.execution?.experiment;
  if (
    archive?.format !== "veil.experiment-archive.v0" ||
    archive.archiveHash !== record.archiveHash ||
    archive.execution.format !== "veil.experiment-execution.v0" ||
    experiment?.format !== "veil.experiment.v0" ||
    experiment.status !== "complete" ||
    experiment.experimentId !== record.experimentId ||
    experiment.hypothesis.hypothesisRef !== hypothesisRef ||
    experiment.hypothesis.registrationStatus !== "preregistered" ||
    experiment.hypothesis.registrationHash === null ||
    !SHA256.test(experiment.hypothesis.registrationHash) ||
    experiment.hypothesis.registrationStatus !== record.registrationStatus ||
    experiment.verdict !== record.verdict ||
    experiment.claimStatus !== record.claimStatus ||
    experiment.artifactHash !== record.artifactHash ||
    experiment.planHash !== record.planHash ||
    experiment.contractHash !== record.contractHash ||
    experiment.candidateHash !== record.candidateHash ||
    archive.readSetSnapshotIds.length === 0 ||
    archive.readSetSnapshotIds.some((snapshotId) => !SHA256.test(snapshotId))
  ) {
    throw unavailable("The Experiment archive does not match its Loom verification record");
  }
}

function historyBytes(
  projectId: string,
  totalCount: number,
  experiments: LoomProjectExperimentsResponse["experiments"],
): number {
  return Buffer.byteLength(
    canonicalJson({
      format: "loom.project-experiments.v0",
      projectId,
      totalCount,
      experiments,
      truncated: totalCount > experiments.length,
    }),
    "utf8",
  );
}

function veilHash(domain: string, input: unknown): string {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonicalJson(input))
    .digest("hex")}`;
}

function notFound(): ExperimentAccessError {
  return new ExperimentAccessError(
    "EXPERIMENT_NOT_FOUND",
    "The Experiment does not belong to this Veil session",
  );
}

function unavailable(message: string, cause?: unknown): ExperimentAccessError {
  return new ExperimentAccessError(
    "EXPERIMENT_UNAVAILABLE",
    message,
    cause === undefined ? undefined : { cause },
  );
}
