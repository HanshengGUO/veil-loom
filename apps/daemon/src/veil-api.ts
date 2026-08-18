import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { tsImport } from "tsx/esm/api";

export const VEIL_SUPPORTED_RANGE = ">=0.1.0 <0.2.0" as const;

export interface VeilProject {
  readonly root: string;
  readonly datasets: ReadonlyMap<string, unknown>;
  readonly runtimes: { list(): readonly unknown[] };
  readonly promotionConcurrency: number;
  readonly costModels?: { list(): readonly unknown[] };
  readonly nullGenerators?: { list(): readonly unknown[] };
}

interface PublicVeilError {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly remedy: string;
}

interface VeilExtensionOptions {
  readonly projectLoader?: (cwd: string) => Promise<VeilProject>;
  readonly now?: () => Date;
}

export interface VeilHypothesisEntry {
  readonly format: "veil.hypothesis.v0";
  readonly hypothesisRef: string;
  readonly statement: string;
  readonly ideaAvailableAt: string;
  readonly captureMode: "automatic" | "explicit";
}

export interface VeilDataToolResult {
  readonly format: "veil.agent-tool-result.v0";
  readonly tool: "veil-data";
  readonly ok: true;
  readonly dataset: string;
  readonly adapterVersion: string;
  readonly view: {
    readonly mode: "point" | "panel";
    readonly grade: "guarded" | "exploration-grade";
    readonly asOf: string;
    readonly rowCount: number;
  };
  readonly evidence: {
    readonly readSetId: string;
    readonly resultHash: string;
    readonly arrowHash: string;
  };
  readonly exportReference: string | null;
}

export interface VeilBacktestSuccess {
  readonly format: "veil.agent-tool-result.v0";
  readonly tool: "veil-backtest";
  readonly ok: true;
  readonly researchRunId: string;
  readonly status: "awaiting-pricing-and-gates" | "complete";
  readonly structuralStatus: "contract-verified";
  readonly claimStatus: "unverified" | "verified" | "degraded" | "rejected";
  readonly registrationStatus: "preregistered" | "exploratory";
  readonly artifactHash: string;
  readonly planHash: string;
  readonly contractHash: string;
  readonly candidateHash: string;
  readonly executionCount: number;
  readonly requiredEvidence: readonly ["pricing", "costs", "statistical-gates"] | readonly [];
  readonly evidenceReference: string;
  readonly researchLogReference: ".veil/research-log.md";
  readonly experimentId?: string;
  readonly verdict?: "accepted" | "degraded" | "rejected";
  readonly experimentArchiveReference?: string;
}

export interface VeilBacktestFailure extends PublicVeilError {
  readonly format: "veil.agent-tool-result.v0";
  readonly tool: "veil-backtest";
  readonly researchRunId: string;
}

export type VeilBacktestToolResult = VeilBacktestSuccess | VeilBacktestFailure;

export interface VeilExperimentArchive {
  readonly format: "veil.experiment-archive.v0";
  readonly archiveHash: string;
  readonly readSetSnapshotIds: readonly string[];
  readonly execution: {
    readonly format: "veil.experiment-execution.v0";
    readonly experiment: {
      readonly format: "veil.experiment.v0";
      readonly status: "complete";
      readonly experimentId: string;
      readonly candidateHash: string;
      readonly artifactHash: string;
      readonly planHash: string;
      readonly contractHash: string;
      readonly parameterLockHash: string;
      readonly pricingHash: string;
      readonly gateEvaluationHash: string;
      readonly policyHash: string;
      readonly pricing: {
        readonly method: {
          readonly id: string;
          readonly version: string;
          readonly implementationHash: string;
        };
        readonly costModel: {
          readonly reference: string;
          readonly version: string;
          readonly implementationHash: string;
          readonly configurationHash: string;
        };
        readonly sample: {
          readonly observations: number;
          readonly periodsPerYear: number;
        };
        readonly series: {
          readonly tradesHash: string;
          readonly grossReturnsHash: string;
          readonly costsHash: string;
          readonly netReturnsHash: string;
        };
      };
      readonly effectiveTrials: number;
      readonly hypothesis: {
        readonly hypothesisRef: string;
        readonly registrationHash: string | null;
        readonly registrationStatus: "preregistered" | "exploratory";
      };
      readonly dataset: {
        readonly dataset: string;
        readonly version: string;
        readonly declarationHash: string;
        readonly degradations: readonly string[];
      };
      readonly metrics: readonly {
        readonly name: string;
        readonly scope: "walk-forward-oos";
        readonly basis: "gross" | "net";
        readonly unit: "count" | "decimal" | "ratio";
        readonly value: number;
      }[];
      readonly gates: readonly {
        readonly gateId: string;
        readonly gateVersion: string;
        readonly category: "costs" | "statistical-gates";
        readonly required: boolean;
        readonly outcome: "failed" | "passed" | "unavailable";
        readonly reasonCode: string;
        readonly implementationHash: string;
        readonly evidenceHash: string;
      }[];
      readonly verdict: "accepted" | "degraded" | "rejected";
      readonly claimStatus: "verified" | "degraded" | "rejected";
      readonly issuedAt: string;
      readonly rationale: string;
      readonly lessons: readonly string[];
    };
  };
}

export interface VeilExperimentReproduction {
  readonly format: "veil.experiment-reproduction.v0";
  readonly experimentId: string;
  readonly reproducedExperimentId: string;
  readonly pricingHash: string;
  readonly gateEvaluationHash: string;
  readonly metricsHash: string;
  readonly status: "matched";
  readonly reproductionHash: string;
}

export interface VeilPublicApi {
  readonly loadVeilProject: (cwd: string) => Promise<VeilProject>;
  readonly createVeilExtension: (options?: VeilExtensionOptions) => InlineExtension;
  readonly describeVeilError: (error: unknown) => PublicVeilError;
  readonly createHypothesisEntry: (input: {
    readonly hypothesisRef?: string;
    readonly statement: string;
    readonly ideaAvailableAt: string;
    readonly captureMode: "automatic" | "explicit";
  }) => VeilHypothesisEntry;
  readonly executeVeilDataTool: (
    input: {
      readonly dataset: string;
      readonly mode: "point" | "panel";
      readonly as_of: string;
      readonly columns?: readonly string[];
      readonly output: "summary" | "arrow";
    },
    context: {
      readonly project: VeilProject;
      readonly appendEntry: (customType: string, data: unknown) => void;
    },
  ) => Promise<VeilDataToolResult>;
  readonly executeVeilBacktestTool: (
    input: { readonly request: string },
    context: {
      readonly project: VeilProject;
      readonly getBranch: () => readonly unknown[];
      readonly appendEntry: (customType: string, data: unknown) => void;
      readonly signal?: AbortSignal;
    },
  ) => Promise<VeilBacktestToolResult>;
  readonly loadProjectExperiment: (
    projectRoot: string,
    experimentId: string,
  ) => Promise<VeilExperimentArchive>;
  readonly reproduceProjectExperiment: (input: {
    readonly project: VeilProject;
    readonly experimentId: string;
    readonly signal?: AbortSignal;
  }) => Promise<VeilExperimentReproduction>;
  readonly VEIL_PROJECT_FORMAT: "veil.project.v0";
  readonly VEIL_HYPOTHESIS_ENTRY: "veil.hypothesis.v0";
  readonly VEIL_DATA_TOOL: "veil-data";
  readonly VEIL_BACKTEST_TOOL: "veil-backtest";
  readonly VEIL_MEMORY_TOOL: "veil-memory";
}

export interface LoadedVeilApi {
  readonly api: VeilPublicApi;
  readonly version: string;
}

export type VeilApiErrorCode = "VEIL_RUNTIME_UNAVAILABLE" | "VEIL_VERSION_UNSUPPORTED";

export class VeilApiLoadError extends Error {
  readonly code: VeilApiErrorCode;
  readonly installedVersion: string | null;
  readonly remedy: string;

  constructor(
    code: VeilApiErrorCode,
    message: string,
    remedy: string,
    installedVersion: string | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VeilApiLoadError";
    this.code = code;
    this.installedVersion = installedVersion;
    this.remedy = remedy;
  }
}

let loadedApi: Promise<LoadedVeilApi> | undefined;

/** Loads the published TypeScript package through its declared tsx runtime dependency. */
export function loadVeilPublicApi(): Promise<LoadedVeilApi> {
  loadedApi ??= loadVeilPublicApiOnce();
  return loadedApi;
}

async function loadVeilPublicApiOnce(): Promise<LoadedVeilApi> {
  let version: string;
  try {
    version = await installedVeilVersion();
  } catch (error) {
    throw new VeilApiLoadError(
      "VEIL_RUNTIME_UNAVAILABLE",
      "The installed Veil package metadata could not be validated.",
      "Install the supported veil-quant release in the Loom daemon and restart it.",
      null,
      { cause: error },
    );
  }
  if (!/^0\.1\.(0|[1-9][0-9]*)$/u.test(version)) {
    throw new VeilApiLoadError(
      "VEIL_VERSION_UNSUPPORTED",
      "The installed Veil version is outside Loom's tested minor range.",
      `Install veil-quant ${VEIL_SUPPORTED_RANGE} and restart the daemon.`,
      version,
    );
  }

  try {
    const input: unknown = await tsImport("veil-quant", import.meta.url);
    if (!isVeilPublicApi(input)) throw new Error("unsupported Veil public API");
    return Object.freeze({ api: input, version });
  } catch (error) {
    throw new VeilApiLoadError(
      "VEIL_RUNTIME_UNAVAILABLE",
      "The Veil runtime could not be loaded through its published API.",
      "Reinstall the supported veil-quant package and restart the daemon.",
      version,
      { cause: error },
    );
  }
}

async function installedVeilVersion(): Promise<string> {
  const entry = createRequire(import.meta.url).resolve("veil-quant");
  let directory = dirname(entry);
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const input: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      const version = veilMetadataVersion(input);
      if (version !== undefined) return version;
    } catch {
      // Published layouts may put the export below the package root.
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("Veil package metadata was not found");
}

function veilMetadataVersion(input: unknown): string | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    !("name" in input) ||
    input.name !== "veil-quant" ||
    !("version" in input) ||
    typeof input.version !== "string" ||
    input.version.length === 0 ||
    input.version.length > 64
  ) {
    return undefined;
  }
  return input.version;
}

function isVeilPublicApi(input: unknown): input is VeilPublicApi {
  return (
    input !== null &&
    typeof input === "object" &&
    "loadVeilProject" in input &&
    typeof input.loadVeilProject === "function" &&
    "createVeilExtension" in input &&
    typeof input.createVeilExtension === "function" &&
    "describeVeilError" in input &&
    typeof input.describeVeilError === "function" &&
    "createHypothesisEntry" in input &&
    typeof input.createHypothesisEntry === "function" &&
    "executeVeilDataTool" in input &&
    typeof input.executeVeilDataTool === "function" &&
    "executeVeilBacktestTool" in input &&
    typeof input.executeVeilBacktestTool === "function" &&
    "loadProjectExperiment" in input &&
    typeof input.loadProjectExperiment === "function" &&
    "reproduceProjectExperiment" in input &&
    typeof input.reproduceProjectExperiment === "function" &&
    "VEIL_PROJECT_FORMAT" in input &&
    input.VEIL_PROJECT_FORMAT === "veil.project.v0" &&
    "VEIL_HYPOTHESIS_ENTRY" in input &&
    input.VEIL_HYPOTHESIS_ENTRY === "veil.hypothesis.v0" &&
    "VEIL_DATA_TOOL" in input &&
    input.VEIL_DATA_TOOL === "veil-data" &&
    "VEIL_BACKTEST_TOOL" in input &&
    input.VEIL_BACKTEST_TOOL === "veil-backtest" &&
    "VEIL_MEMORY_TOOL" in input &&
    input.VEIL_MEMORY_TOOL === "veil-memory"
  );
}
