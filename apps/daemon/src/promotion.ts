import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import {
  isLoomPublishedViewDescriptor,
  type LoomCreatePromotionRequest,
  type LoomDigest,
} from "@veilquant/loom-protocol";
import type { SessionEventStoreRegistry } from "./event-store.js";
import type { LoomProjectRegistry } from "./project-readiness.js";
import { canonicalJson, type ResearchArtifactStore } from "./research-artifacts.js";

const DAILY_FACTOR_ADAPTER_ID = "loom.reference.daily-factor";
const DAILY_FACTOR_ADAPTER_VERSION = "0";
const DAILY_FACTOR_DATASET = "daily-factor-prices";
const DAILY_FACTOR_COST_MODEL = "daily-factor-10bps";
const DAILY_FACTOR_NULL_GENERATOR = "daily-factor-centered-blocks";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const VEIL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const MAXIMUM_ARTIFACT_BYTES = 1024 * 1024;

export const DAILY_FACTOR_DECISION_SCHEDULE = Object.freeze(
  Array.from({ length: 35 }, (_, index) => new Date(Date.UTC(2024, 0, index + 1)).toISOString()),
);

export interface PreparePromotionInput {
  readonly projectId: string;
  readonly sourceSessionId: string;
  readonly request: LoomCreatePromotionRequest;
}

export interface PreparedPromotion {
  readonly sourceSessionId: string;
  readonly sourceViewId: string;
  readonly artifact: {
    readonly id: string;
    readonly reference: string;
    readonly digest: LoomDigest;
  };
  readonly hypothesisStatement: string;
}

export interface WritePromotionRequestInput {
  readonly projectRoot: string;
  readonly attemptId: string;
  readonly hypothesisRef: string;
  readonly developmentReadSetId: string;
  readonly promotion: PreparedPromotion;
}

export class PromotionPreparationError extends Error {
  readonly code: "PROJECT_NOT_READY" | "PROMOTION_NOT_AVAILABLE";

  constructor(code: PromotionPreparationError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PromotionPreparationError";
    this.code = code;
  }
}

/** Validates the only v0 portable handoff without accepting Raw metrics or browser-owned paths. */
export class LoomPromotionCoordinator {
  readonly #artifacts: ResearchArtifactStore;
  readonly #eventStores: SessionEventStoreRegistry;
  readonly #projects: LoomProjectRegistry;

  constructor(options: {
    artifacts: ResearchArtifactStore;
    eventStores: SessionEventStoreRegistry;
    projects: LoomProjectRegistry;
  }) {
    this.#artifacts = options.artifacts;
    this.#eventStores = options.eventStores;
    this.#projects = options.projects;
  }

  async prepare(input: PreparePromotionInput): Promise<PreparedPromotion> {
    try {
      await this.#projects.requireVeilProject(input.projectId);
    } catch (error) {
      throw new PromotionPreparationError(
        "PROJECT_NOT_READY",
        "The project is not ready for independent Veil verification",
        { cause: error },
      );
    }
    const view = await this.#artifacts.readView({
      projectId: input.projectId,
      sessionId: input.sourceSessionId,
      viewId: input.request.viewId,
    });
    const events = await (
      await this.#eventStores.get(input.projectId, input.sourceSessionId)
    ).replay();
    const publication = events.find(
      (event) =>
        event.type === "view.published" &&
        isLoomPublishedViewDescriptor(event.payload) &&
        event.payload.viewId === view.viewId,
    );
    const taskStarted = events.find(
      (event) => event.type === "task.started" && event.payload.taskId === view.provenance.taskId,
    );
    const taskCompleted = events.find(
      (event) => event.type === "task.completed" && event.payload.taskId === view.provenance.taskId,
    );
    const superseded = events.find(
      (event) =>
        publication !== undefined &&
        event.sequence > publication.sequence &&
        event.type === "view.superseded" &&
        event.payload.viewId === view.viewId,
    );
    if (
      publication === undefined ||
      !isLoomPublishedViewDescriptor(publication.payload) ||
      publication.payload.taskId !== view.provenance.taskId ||
      canonicalJson(publication.payload.assurance) !== canonicalJson(view.assurance) ||
      taskStarted === undefined ||
      taskCompleted === undefined ||
      superseded !== undefined ||
      taskStarted.sequence >= publication.sequence ||
      publication.sequence >= taskCompleted.sequence
    ) {
      throw unavailable("The selected view is not a durable output of the source session");
    }
    if (
      view.provenance.adapter.id !== DAILY_FACTOR_ADAPTER_ID ||
      view.provenance.adapter.version !== DAILY_FACTOR_ADAPTER_VERSION ||
      view.provenance.source.artifactId !== "daily-factor-v0" ||
      view.assurance.state !== "exploratory" ||
      view.assurance.issuer !== "loom" ||
      view.assurance.evidenceRefs.length !== 0
    ) {
      throw unavailable("The selected view has no supported promotion recipe");
    }

    const projectRoot = await this.#projects.root(input.projectId);
    const digest = await digestOwnedArtifact(projectRoot, input.request.artifactReference);
    if (digest !== view.provenance.source.artifactDigest) {
      throw unavailable("The selected artifact does not match the source view provenance");
    }
    return Object.freeze({
      sourceSessionId: input.sourceSessionId,
      sourceViewId: view.viewId,
      artifact: Object.freeze({
        id: view.provenance.source.artifactId,
        reference: input.request.artifactReference,
        digest,
      }),
      hypothesisStatement: input.request.hypothesis.statement,
    });
  }
}

export async function writeDailyFactorPromotionRequest(
  input: WritePromotionRequestInput,
): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.attemptId)) {
    throw unavailable("The verification attempt identity is invalid");
  }
  if (!VEIL_REFERENCE.test(input.hypothesisRef) || !SHA256.test(input.developmentReadSetId)) {
    throw unavailable("Veil returned an invalid portable promotion identity");
  }
  const digest = await digestOwnedArtifact(input.projectRoot, input.promotion.artifact.reference);
  if (digest !== input.promotion.artifact.digest) {
    throw unavailable("The selected artifact changed before verification began");
  }

  const codeRoot = posix.dirname(input.promotion.artifact.reference);
  const entryFile = posix.basename(input.promotion.artifact.reference);
  const requestReference = `.veil/loom-attempts/${input.attemptId}.yaml`;
  let veilRoot: string;
  try {
    veilRoot = await realpath(resolve(input.projectRoot, ".veil"));
  } catch (error) {
    throw unavailable("The Veil project directory is unavailable", error);
  }
  assertWithin(input.projectRoot, veilRoot);
  const attemptsRoot = resolve(veilRoot, "loom-attempts");
  await mkdir(attemptsRoot, { recursive: true, mode: 0o700 });
  const canonicalAttemptsRoot = await realpath(attemptsRoot);
  assertWithin(veilRoot, canonicalAttemptsRoot);
  const requestPath = resolve(canonicalAttemptsRoot, `${input.attemptId}.yaml`);
  assertWithin(canonicalAttemptsRoot, requestPath);
  const schedule = DAILY_FACTOR_DECISION_SCHEDULE.map((time) => `  - ${quote(time)}`).join("\n");
  const bytes = `format: veil.promotion-request.v0
dataset: ${quote(DAILY_FACTOR_DATASET)}
hypothesis_ref: ${quote(input.hypothesisRef)}
factor:
  code_root: ${quote(codeRoot)}
  files: [${quote(entryFile)}]
  runtime: { id: veil-node, constraint: ">=20.10.0,<30" }
  entry: { file: ${quote(entryFile)}, callable: compute }
params_locked: { lookback_days: 2 }
declared_literals: {}
trials_declared: 1
development_read_sets:
  - ${quote(input.developmentReadSetId)}
protocol:
  mode: rolling
  folds: 3
  train_days: 3
  oos_days: 10
  purge_days: 1
  embargo_days: 1
  hold_days: 1
  execution_lag_days: 1
decision_schedule:
${schedule}
columns: [ticker, close, volume]
cost_model: ${quote(DAILY_FACTOR_COST_MODEL)}
stage4:
  signal_column: score
  price_column: close
  market_columns: [volume]
  periods_per_year: 252
  portfolio_kind: long-short-quantile
  quantile: 0.25
  weight_column: null
  capacity:
    portfolio_nav: 1000000
    volume_column: volume
    maximum_participation_rate: 0.05
  null_generator: ${quote(DAILY_FACTOR_NULL_GENERATOR)}
  trial_budget: 16
  knowledge_cutoff: null
`;
  try {
    await writeFile(requestPath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    throw unavailable("The private promotion request could not be persisted", error);
  }
  return requestReference;
}

async function digestOwnedArtifact(projectRoot: string, reference: string): Promise<LoomDigest> {
  const requested = resolve(projectRoot, ...reference.split("/"));
  let path: string;
  try {
    const requestedMetadata = await lstat(requested);
    if (
      requestedMetadata.isSymbolicLink() ||
      !requestedMetadata.isFile() ||
      requestedMetadata.size > MAXIMUM_ARTIFACT_BYTES
    ) {
      throw new Error();
    }
    path = await realpath(requested);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > MAXIMUM_ARTIFACT_BYTES) throw new Error();
  } catch (error) {
    throw unavailable("The selected artifact is not a bounded project file", error);
  }
  assertWithin(projectRoot, path);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw unavailable("The selected artifact could not be read", error);
  }
  if (bytes.byteLength > MAXIMUM_ARTIFACT_BYTES) {
    throw unavailable("The selected artifact is too large for the v0 promotion path");
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertWithin(root: string, candidate: string): void {
  const child = relative(root, candidate);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw unavailable("The promotion file reference escapes the registered project");
  }
}

function quote(input: string): string {
  return JSON.stringify(input);
}

function unavailable(message: string, cause?: unknown): PromotionPreparationError {
  return new PromotionPreparationError(
    "PROMOTION_NOT_AVAILABLE",
    message,
    cause === undefined ? undefined : { cause },
  );
}
