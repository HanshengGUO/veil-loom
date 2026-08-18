import { randomUUID } from "node:crypto";
import {
  isLoomDigest,
  isLoomPortableId,
  type LoomAcceptedCommandResponse,
  type LoomCreatePromotionRequest,
  type LoomExperimentEvidenceResponse,
  type LoomProfileDescriptor,
  type LoomProjectExperimentsResponse,
  type LoomProjectReadinessResponse,
  type LoomPromotionAcceptedResponse,
  type LoomSelection,
  type LoomSessionProfile,
} from "@veilquant/loom-protocol";
import type { SessionEventStoreRegistry } from "./event-store.js";
import {
  ExperimentAccessError,
  LoomExperimentCoordinator,
  type OwnedExperiment,
} from "./experiments.js";
import {
  DeterministicPiSessionFactory,
  type DeterministicPiSessionFactoryOptions,
} from "./pi/deterministic-session.js";
import { LoomProjectRegistry } from "./project-readiness.js";
import {
  LoomPromotionCoordinator,
  type PreparedPromotion,
  PromotionPreparationError,
} from "./promotion.js";
import { DailyFactorReferenceAdapter } from "./reference-backtest/reference-adapter.js";
import { ResearchArtifactStore } from "./research-artifacts.js";
import {
  type LoomRuntimeAdapter,
  RawPiRuntimeAdapter,
  RuntimeAdapterError,
  VeilPiRuntimeAdapter,
} from "./runtime-adapter.js";
import { SelectionService } from "./selection-service.js";
import { projectSessionRecovery } from "./session-recovery.js";

type RuntimeIdKind = "session" | "command" | "task" | "message" | "attempt";

export type RuntimeIdSource = (kind: RuntimeIdKind) => string;

export interface RuntimeHostOptions {
  adapters: readonly LoomRuntimeAdapter[];
  eventStores: SessionEventStoreRegistry;
  projects: LoomProjectRegistry;
  selections?: SelectionService;
  promotions?: LoomPromotionCoordinator;
  experiments?: LoomExperimentCoordinator;
  idSource?: RuntimeIdSource;
}

export interface CreateRuntimeSessionInput {
  projectId: string;
  profile: LoomSessionProfile;
  title?: string;
}

export interface SendRuntimeMessageInput {
  projectId: string;
  sessionId: string;
  content: string;
  selectionId?: string;
}

export interface CancelRuntimeTaskInput {
  projectId: string;
  sessionId: string;
  taskId: string;
}

export interface CreateRuntimePromotionInput {
  projectId: string;
  sourceSessionId: string;
  request: LoomCreatePromotionRequest;
}

export interface RuntimeExperimentInput {
  projectId: string;
  sessionId: string;
  experimentId: string;
}

export interface CreateRuntimeIdentity {
  sessionId: string;
  commandId: string;
}

export interface MessageRuntimeIdentity {
  commandId: string;
  taskId: string;
  messageId: string;
}

export interface PromotionRuntimeIdentity {
  sessionId: string;
  commandId: string;
  taskId: string;
  attemptId: string;
}

export interface TaskRuntimeIdentity {
  commandId: string;
  taskId: string;
}

export interface RuntimeReconciliationReport {
  discovered: number;
  recovered: number;
  skipped: number;
  failed: number;
  interruptedTasks: number;
}

/** Routes profile-neutral commands to one adapter while keeping generated IDs out of adapters. */
export class LoomRuntimeHost {
  readonly #adapters: Map<LoomSessionProfile, LoomRuntimeAdapter>;
  readonly #sessions = new Map<string, LoomRuntimeAdapter>();
  readonly #eventStores: SessionEventStoreRegistry;
  readonly #projects: LoomProjectRegistry;
  readonly #idSource: RuntimeIdSource;
  readonly #selections: SelectionService | undefined;
  readonly #promotions: LoomPromotionCoordinator | undefined;
  readonly #experiments: LoomExperimentCoordinator | undefined;

  constructor(options: RuntimeHostOptions) {
    this.#adapters = new Map(
      options.adapters.map((adapter) => [adapter.descriptor.id, adapter] as const),
    );
    if (this.#adapters.size !== options.adapters.length) {
      throw new Error("Loom runtime profile identifiers must be unique");
    }
    this.#eventStores = options.eventStores;
    this.#projects = options.projects;
    this.#idSource = options.idSource ?? defaultIdSource;
    this.#selections = options.selections;
    this.#promotions = options.promotions;
    this.#experiments = options.experiments;
  }

  profileDescriptors(): readonly LoomProfileDescriptor[] {
    return [...this.#adapters.values()].map((adapter) => adapter.descriptor);
  }

  projectReadiness(projectId: string): Promise<LoomProjectReadinessResponse> {
    assertRuntimeId(projectId);
    return this.#projects.readiness(projectId);
  }

  async projectExperiments(projectId: string): Promise<LoomProjectExperimentsResponse> {
    assertRuntimeId(projectId);
    if (this.#experiments === undefined) {
      throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", "Experiment history is unavailable");
    }
    try {
      return await this.#experiments.list(projectId);
    } catch (error) {
      throw experimentRuntimeError(error);
    }
  }

  async reconcileDurableSessions(): Promise<RuntimeReconciliationReport> {
    const identities = await this.#eventStores.discover();
    const report: RuntimeReconciliationReport = {
      discovered: identities.length,
      recovered: 0,
      skipped: 0,
      failed: 0,
      interruptedTasks: 0,
    };

    for (const identity of identities) {
      const key = runtimeKey(identity.projectId, identity.sessionId);
      if (this.#sessions.has(key)) {
        report.skipped += 1;
        continue;
      }
      try {
        const store = await this.#eventStores.get(identity.projectId, identity.sessionId);
        const plan = projectSessionRecovery(
          identity.projectId,
          identity.sessionId,
          await store.replay(),
        );
        const adapter = this.#adapters.get(plan.profile);
        if (
          adapter === undefined ||
          plan.disposition === "closed" ||
          plan.disposition === "failed"
        ) {
          report.skipped += 1;
          continue;
        }
        report.interruptedTasks += plan.interruptedTaskIds.length;
        const recovered = await adapter.recover(plan);
        if (recovered === undefined) {
          report.failed += 1;
          continue;
        }
        this.#sessions.set(key, adapter);
        report.recovered += 1;
      } catch {
        // A corrupt or unavailable session is isolated; other durable sessions can still recover.
        report.failed += 1;
      }
    }
    return report;
  }

  async createSession(
    input: CreateRuntimeSessionInput,
    identity: CreateRuntimeIdentity = {
      sessionId: "",
      commandId: "",
    },
  ): Promise<LoomAcceptedCommandResponse> {
    assertRuntimeId(input.projectId);
    const adapter = this.#adapters.get(input.profile);
    if (adapter === undefined) {
      throw new RuntimeAdapterError(
        "PROFILE_UNAVAILABLE",
        `The ${input.profile} profile is not available in this daemon`,
      );
    }
    const sessionId = identity.sessionId || this.#nextId("session");
    const commandId = identity.commandId || this.#nextId("command");
    assertRuntimeId(sessionId);
    assertRuntimeId(commandId);
    const key = runtimeKey(input.projectId, sessionId);
    if (this.#sessions.has(key)) {
      throw new RuntimeAdapterError("SESSION_CONFLICT", "The session is already registered");
    }

    await adapter.start({
      projectId: input.projectId,
      sessionId,
      commandId,
      ...(input.title === undefined ? {} : { title: input.title }),
    });
    this.#sessions.set(key, adapter);
    return {
      format: "loom.command.accepted.v0",
      commandId,
      projectId: input.projectId,
      sessionId,
    };
  }

  async sendMessage(
    input: SendRuntimeMessageInput,
    identity: MessageRuntimeIdentity = {
      commandId: "",
      taskId: "",
      messageId: "",
    },
  ): Promise<LoomAcceptedCommandResponse> {
    const adapter = this.#requireSession(input.projectId, input.sessionId);
    const commandId = identity.commandId || this.#nextId("command");
    const taskId = identity.taskId || this.#nextId("task");
    const messageId = identity.messageId || this.#nextId("message");
    for (const id of [input.projectId, input.sessionId, commandId, taskId, messageId]) {
      assertRuntimeId(id);
    }
    let selection: LoomSelection | undefined;
    if (input.selectionId !== undefined) {
      if (this.#selections === undefined) {
        throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", "Selection context is unavailable");
      }
      selection = await this.#selections.resolve(
        input.projectId,
        input.sessionId,
        input.selectionId,
      );
    }
    const { selectionId: _selectionId, ...message } = input;
    return adapter.send({
      ...message,
      commandId,
      taskId,
      messageId,
      ...(selection === undefined ? {} : { selection }),
    });
  }

  async cancelTask(
    input: CancelRuntimeTaskInput,
    commandId = "",
  ): Promise<LoomAcceptedCommandResponse> {
    const adapter = this.#requireSession(input.projectId, input.sessionId);
    const resolvedCommandId = commandId || this.#nextId("command");
    for (const id of [input.projectId, input.sessionId, input.taskId, resolvedCommandId]) {
      assertRuntimeId(id);
    }
    return adapter.cancel({ ...input, commandId: resolvedCommandId });
  }

  async createPromotion(
    input: CreateRuntimePromotionInput,
    identity: PromotionRuntimeIdentity = {
      sessionId: "",
      commandId: "",
      taskId: "",
      attemptId: "",
    },
  ): Promise<LoomPromotionAcceptedResponse> {
    assertRuntimeId(input.projectId);
    assertRuntimeId(input.sourceSessionId);
    const sourceAdapter = this.#requireSession(input.projectId, input.sourceSessionId);
    if (sourceAdapter.descriptor.id !== "raw-pi") {
      throw new RuntimeAdapterError(
        "PROMOTION_NOT_AVAILABLE",
        "Only a Raw Pi session can start this promotion path",
      );
    }
    if (this.#promotions === undefined) {
      throw new RuntimeAdapterError(
        "RUNTIME_UNAVAILABLE",
        "The promotion coordinator is unavailable",
      );
    }
    let promotion: PreparedPromotion;
    try {
      promotion = await this.#promotions.prepare(input);
    } catch (error) {
      if (error instanceof PromotionPreparationError) {
        throw new RuntimeAdapterError(error.code, error.message, { cause: error });
      }
      throw error;
    }

    const adapter = this.#adapters.get("veil");
    if (adapter === undefined) {
      throw new RuntimeAdapterError("PROFILE_UNAVAILABLE", "The Veil profile is unavailable");
    }
    const sessionId = identity.sessionId || this.#nextId("session");
    const commandId = identity.commandId || this.#nextId("command");
    const taskId = identity.taskId || this.#nextId("task");
    const attemptId = identity.attemptId || this.#nextId("attempt");
    for (const id of [sessionId, commandId, taskId, attemptId]) assertRuntimeId(id);
    if (sessionId === input.sourceSessionId) {
      throw new RuntimeAdapterError(
        "PROMOTION_NOT_AVAILABLE",
        "A promotion must create a new Veil session",
      );
    }
    const key = runtimeKey(input.projectId, sessionId);
    if (this.#sessions.has(key)) {
      throw new RuntimeAdapterError("SESSION_CONFLICT", "The target session is already registered");
    }

    await adapter.start({
      projectId: input.projectId,
      sessionId,
      commandId,
      title: "Veil verification attempt",
    });
    this.#sessions.set(key, adapter);
    try {
      await adapter.promote({
        projectId: input.projectId,
        sessionId,
        commandId,
        taskId,
        attemptId,
        promotion,
      });
    } catch (error) {
      await adapter.close({ projectId: input.projectId, sessionId }).catch(() => undefined);
      this.#sessions.delete(key);
      throw error;
    }
    return {
      format: "loom.promotion.accepted.v0",
      commandId,
      projectId: input.projectId,
      sourceSessionId: input.sourceSessionId,
      sessionId,
      taskId,
      attemptId,
    };
  }

  async experimentEvidence(input: RuntimeExperimentInput): Promise<LoomExperimentEvidenceResponse> {
    assertRuntimeId(input.projectId);
    assertRuntimeId(input.sessionId);
    if (!isLoomDigest(input.experimentId)) {
      throw new RuntimeAdapterError("EXPERIMENT_NOT_FOUND", "The Experiment identity is invalid");
    }
    if (this.#experiments === undefined) {
      throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", "Experiment evidence is unavailable");
    }
    try {
      return await this.#experiments.evidence(input);
    } catch (error) {
      throw experimentRuntimeError(error);
    }
  }

  async reproduceExperiment(
    input: RuntimeExperimentInput,
    identity: TaskRuntimeIdentity = { commandId: "", taskId: "" },
  ): Promise<LoomAcceptedCommandResponse> {
    assertRuntimeId(input.projectId);
    assertRuntimeId(input.sessionId);
    if (!isLoomDigest(input.experimentId)) {
      throw new RuntimeAdapterError("EXPERIMENT_NOT_FOUND", "The Experiment identity is invalid");
    }
    const adapter = this.#requireVeilSession(input.projectId, input.sessionId);
    if (this.#experiments === undefined) {
      throw new RuntimeAdapterError(
        "RUNTIME_UNAVAILABLE",
        "Experiment reproduction is unavailable",
      );
    }
    let experiment: OwnedExperiment;
    try {
      experiment = await this.#experiments.prepareReproduction(input);
    } catch (error) {
      throw experimentRuntimeError(error);
    }
    const commandId = identity.commandId || this.#nextId("command");
    const taskId = identity.taskId || this.#nextId("task");
    for (const id of [commandId, taskId]) assertRuntimeId(id);
    await adapter.reproduce({
      projectId: input.projectId,
      sessionId: input.sessionId,
      commandId,
      taskId,
      experiment,
    });
    return {
      format: "loom.command.accepted.v0",
      commandId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      taskId,
    };
  }

  async closeSession(projectId: string, sessionId: string): Promise<void> {
    const key = runtimeKey(projectId, sessionId);
    const adapter = this.#sessions.get(key);
    if (adapter === undefined) return;
    await adapter.close({ projectId, sessionId });
    this.#sessions.delete(key);
  }

  async waitForIdle(projectId: string, sessionId: string): Promise<void> {
    const adapter = this.#requireSession(projectId, sessionId);
    await adapter.waitForIdle?.(projectId, sessionId);
  }

  #requireSession(projectId: string, sessionId: string): LoomRuntimeAdapter {
    const adapter = this.#sessions.get(runtimeKey(projectId, sessionId));
    if (adapter === undefined) {
      throw new RuntimeAdapterError("SESSION_NOT_FOUND", "The runtime session was not found");
    }
    return adapter;
  }

  #requireVeilSession(projectId: string, sessionId: string): LoomRuntimeAdapter {
    const adapter = this.#requireSession(projectId, sessionId);
    if (adapter.descriptor.id !== "veil") {
      throw new RuntimeAdapterError(
        "EXPERIMENT_NOT_FOUND",
        "Experiment evidence belongs only to a Veil session",
      );
    }
    return adapter;
  }

  #nextId(kind: RuntimeIdKind): string {
    const id = this.#idSource(kind);
    assertRuntimeId(id);
    return id;
  }
}

export interface DefaultRuntimeHostOptions {
  eventStores: SessionEventStoreRegistry;
  artifacts?: ResearchArtifactStore;
  cwd: string;
  agentDir: string;
  fixture?: DeterministicPiSessionFactoryOptions;
  idSource?: RuntimeIdSource;
  selections?: SelectionService;
  projects?: LoomProjectRegistry;
}

export function createDefaultRuntimeHost(options: DefaultRuntimeHostOptions): LoomRuntimeHost {
  const artifacts =
    options.artifacts ?? new ResearchArtifactStore({ stateRoot: options.eventStores.stateRoot });
  const referenceBacktests = new DailyFactorReferenceAdapter(artifacts);
  const selections =
    options.selections ?? new SelectionService({ artifacts, eventStores: options.eventStores });
  const projects = options.projects ?? new LoomProjectRegistry({ fallbackRoot: options.cwd });
  const promotions = new LoomPromotionCoordinator({
    artifacts,
    eventStores: options.eventStores,
    projects,
  });
  const experiments = new LoomExperimentCoordinator({
    eventStores: options.eventStores,
    projects,
  });
  const sessionFactory = new DeterministicPiSessionFactory({ referenceBacktests }, options.fixture);
  const rawPi = new RawPiRuntimeAdapter({
    eventStores: options.eventStores,
    sessionFactory,
    cwd: options.cwd,
    agentDir: options.agentDir,
    projects,
  });
  const veilPi = new VeilPiRuntimeAdapter({
    eventStores: options.eventStores,
    sessionFactory,
    cwd: options.cwd,
    agentDir: options.agentDir,
    projects,
  });
  return new LoomRuntimeHost({
    adapters: [rawPi, veilPi],
    eventStores: options.eventStores,
    projects,
    selections,
    promotions,
    experiments,
    ...(options.idSource === undefined ? {} : { idSource: options.idSource }),
  });
}

function defaultIdSource(kind: RuntimeIdKind): string {
  return `${kind}_${randomUUID()}`;
}

function experimentRuntimeError(error: unknown): RuntimeAdapterError {
  if (error instanceof ExperimentAccessError) {
    return new RuntimeAdapterError(error.code, error.message, { cause: error });
  }
  return new RuntimeAdapterError("EXPERIMENT_UNAVAILABLE", "Experiment evidence is unavailable", {
    cause: error,
  });
}

function assertRuntimeId(input: string): void {
  if (!isLoomPortableId(input)) {
    throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", "The runtime produced an invalid ID");
  }
}

function runtimeKey(projectId: string, sessionId: string): string {
  return `${projectId}\0${sessionId}`;
}
