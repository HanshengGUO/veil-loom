import { lstat, realpath } from "node:fs/promises";
import { parse, resolve } from "node:path";
import {
  isLoomPortableId,
  type LoomProjectReadinessIssue,
  type LoomProjectReadinessResponse,
  type LoomVeilProjectSummary,
  type LoomVeilRuntimeReadiness,
  VEIL_PROFILE,
} from "@veilquant/loom-protocol";
import {
  type LoadedVeilApi,
  loadVeilPublicApi,
  VEIL_SUPPORTED_RANGE,
  VeilApiLoadError,
  type VeilProject,
} from "./veil-api.js";

const DEFAULT_PROJECT_ID = "local-project";

export interface LoomProjectRegistration {
  projectId: string;
  root: string;
}

export interface LoomProjectRegistryOptions {
  registrations?: readonly LoomProjectRegistration[];
  fallbackRoot?: string;
  veilApiLoader?: () => Promise<LoadedVeilApi>;
}

export interface VeilProjectContext {
  readonly root: string;
  readonly project: VeilProject;
  readonly veil: LoadedVeilApi;
}

export class ProjectReadinessError extends Error {
  readonly code = "PROJECT_NOT_READY" as const;
  readonly readiness: LoomProjectReadinessResponse;

  constructor(readiness: LoomProjectReadinessResponse) {
    super("The project is not ready for the Veil profile");
    this.name = "ProjectReadinessError";
    this.readiness = readiness;
  }
}

/** Owns daemon-authorized project roots and exposes only path-free readiness summaries. */
export class LoomProjectRegistry {
  readonly #roots = new Map<string, string>();
  readonly #canonicalRoots = new Map<string, Promise<string>>();
  readonly #fallbackRoot: string | undefined;
  readonly #veilApiLoader: () => Promise<LoadedVeilApi>;

  constructor(options: LoomProjectRegistryOptions = {}) {
    for (const registration of options.registrations ?? []) {
      assertProjectId(registration.projectId);
      if (registration.root.length === 0 || this.#roots.has(registration.projectId)) {
        throw new Error("Loom project registrations must have unique IDs and non-empty roots");
      }
      this.#roots.set(registration.projectId, registration.root);
    }
    this.#fallbackRoot = options.fallbackRoot;
    this.#veilApiLoader = options.veilApiLoader ?? loadVeilPublicApi;
  }

  async root(projectId: string): Promise<string> {
    assertProjectId(projectId);
    const candidate = this.#roots.get(projectId) ?? this.#fallbackRoot;
    if (candidate === undefined) {
      throw new ProjectRootError(
        "PROJECT_NOT_REGISTERED",
        "The project is not registered with this daemon.",
        "Start the daemon from the project root with the matching LOOM_PROJECT_ID.",
      );
    }
    const key = this.#roots.has(projectId) ? projectId : `*\0${candidate}`;
    let canonical = this.#canonicalRoots.get(key);
    if (canonical === undefined) {
      canonical = canonicalProjectRoot(candidate);
      this.#canonicalRoots.set(key, canonical);
      canonical.catch(() => this.#canonicalRoots.delete(key));
    }
    return canonical;
  }

  async readiness(projectId: string): Promise<LoomProjectReadinessResponse> {
    return (await this.#inspect(projectId)).readiness;
  }

  async requireVeilProject(projectId: string): Promise<VeilProjectContext> {
    const inspection = await this.#inspect(projectId);
    if (inspection.context === undefined) throw new ProjectReadinessError(inspection.readiness);
    return inspection.context;
  }

  async #inspect(projectId: string): Promise<{
    readiness: LoomProjectReadinessResponse;
    context?: VeilProjectContext;
  }> {
    assertProjectId(projectId);
    let veil: LoadedVeilApi;
    try {
      veil = await this.#veilApiLoader();
    } catch (error) {
      const failure =
        error instanceof VeilApiLoadError
          ? error
          : new VeilApiLoadError(
              "VEIL_RUNTIME_UNAVAILABLE",
              "The Veil runtime could not be loaded through its published API.",
              "Reinstall the supported veil-quant package and restart the daemon.",
              null,
            );
      return {
        readiness: unavailableReadiness(projectId, runtimeSummary(failure), {
          code: failure.code,
          message: failure.message,
          remedy: failure.remedy,
        }),
      };
    }

    let root: string;
    try {
      root = await this.root(projectId);
    } catch (error) {
      const failure =
        error instanceof ProjectRootError
          ? error
          : new ProjectRootError(
              "PROJECT_ROOT_UNAVAILABLE",
              "The registered project root could not be opened.",
              "Restart the daemon from a readable project directory.",
            );
      return {
        readiness: unavailableReadiness(projectId, runtimeSummary(veil), {
          code: failure.code,
          message: failure.message,
          remedy: failure.remedy,
        }),
      };
    }

    try {
      const project = await veil.api.loadVeilProject(root);
      const summary = summarizeProject(project, root);
      return {
        readiness: {
          format: "loom.project-readiness.v0",
          projectId,
          profile: "veil",
          status: "ready",
          runtime: runtimeSummary(veil),
          capabilities: [...VEIL_PROFILE.capabilities],
          project: summary,
        },
        context: Object.freeze({ root, project, veil }),
      };
    } catch (error) {
      return {
        readiness: {
          format: "loom.project-readiness.v0",
          projectId,
          profile: "veil",
          status: "invalid",
          runtime: runtimeSummary(veil),
          capabilities: [],
          issue: publicVeilIssue(veil, error, root),
        },
      };
    }
  }
}

export function resolveConfiguredProjectId(input: string | undefined): string {
  const projectId = input ?? DEFAULT_PROJECT_ID;
  assertProjectId(projectId);
  return projectId;
}

class ProjectRootError extends Error {
  readonly code: "PROJECT_NOT_REGISTERED" | "PROJECT_ROOT_UNAVAILABLE";
  readonly remedy: string;

  constructor(code: ProjectRootError["code"], message: string, remedy: string) {
    super(message);
    this.name = "ProjectRootError";
    this.code = code;
    this.remedy = remedy;
  }
}

async function canonicalProjectRoot(input: string): Promise<string> {
  try {
    const root = await realpath(resolve(input));
    if (!(await lstat(root)).isDirectory() || root === parse(root).root) throw new Error();
    return root;
  } catch {
    throw new ProjectRootError(
      "PROJECT_ROOT_UNAVAILABLE",
      "The registered project root could not be opened.",
      "Restart the daemon from a readable project directory that is not a filesystem root.",
    );
  }
}

function unavailableReadiness(
  projectId: string,
  runtime: LoomVeilRuntimeReadiness,
  issue: LoomProjectReadinessIssue,
): LoomProjectReadinessResponse {
  return {
    format: "loom.project-readiness.v0",
    projectId,
    profile: "veil",
    status: "unavailable",
    runtime,
    capabilities: [],
    issue,
  };
}

function runtimeSummary(input: LoadedVeilApi | VeilApiLoadError): LoomVeilRuntimeReadiness {
  if (input instanceof VeilApiLoadError) {
    return {
      package: "veil-quant",
      installedVersion: input.installedVersion,
      supportedRange: VEIL_SUPPORTED_RANGE,
      detectedFormats: [],
    };
  }
  return {
    package: "veil-quant",
    installedVersion: input.version,
    supportedRange: VEIL_SUPPORTED_RANGE,
    detectedFormats: ["veil.project.v0"],
  };
}

function summarizeProject(project: VeilProject, root: string): LoomVeilProjectSummary {
  const runtimeCount = project.runtimes.list().length;
  const costModelCount = project.costModels?.list().length ?? 0;
  const nullGeneratorCount = project.nullGenerators?.list().length ?? 0;
  if (
    project.root !== root ||
    !Number.isInteger(project.datasets.size) ||
    project.datasets.size < 1 ||
    !Number.isInteger(runtimeCount) ||
    runtimeCount < 1 ||
    !Number.isInteger(project.promotionConcurrency) ||
    project.promotionConcurrency < 1 ||
    project.promotionConcurrency > 16 ||
    !Number.isInteger(costModelCount) ||
    costModelCount < 0 ||
    !Number.isInteger(nullGeneratorCount) ||
    nullGeneratorCount < 0
  ) {
    throw new Error("The Veil project runtime does not match Loom's supported public shape");
  }
  return {
    format: "veil.project.v0",
    datasetCount: project.datasets.size,
    runtimeCount,
    promotionConcurrency: project.promotionConcurrency,
    costModelCount,
    nullGeneratorCount,
  };
}

function publicVeilIssue(
  veil: LoadedVeilApi,
  error: unknown,
  root: string,
): LoomProjectReadinessIssue {
  try {
    const diagnostic: unknown = veil.api.describeVeilError(error);
    if (
      diagnostic === null ||
      typeof diagnostic !== "object" ||
      !("code" in diagnostic) ||
      typeof diagnostic.code !== "string" ||
      !("message" in diagnostic) ||
      typeof diagnostic.message !== "string" ||
      !("remedy" in diagnostic) ||
      typeof diagnostic.remedy !== "string"
    ) {
      throw new Error("invalid public diagnostic");
    }
    return {
      code: publicCode(diagnostic.code),
      message: boundedPublic(diagnostic.message, 512, root, "Veil could not validate the project."),
      remedy: boundedPublic(
        diagnostic.remedy,
        1_024,
        root,
        "Correct the project declaration and retry.",
      ),
    };
  } catch {
    return {
      code: "UNEXPECTED_ERROR",
      message: "Veil could not validate the project.",
      remedy: "Correct the project declaration and retry.",
    };
  }
}

function assertProjectId(input: string): void {
  if (!isLoomPortableId(input)) throw new Error("Loom project IDs must be portable identifiers");
}

function boundedPublic(
  input: string,
  maximum: number,
  projectRoot: string,
  fallback: string,
): string {
  let redacted = input;
  for (const path of new Set([
    projectRoot,
    projectRoot.replaceAll("\\", "/"),
    projectRoot.replaceAll("/", "\\"),
  ])) {
    redacted = redacted.split(path).join("[project]");
  }
  const value = redacted.trim() || fallback;
  return value.slice(0, maximum);
}

function publicCode(input: string): string {
  const value = input.trim().slice(0, 64);
  return /^[A-Z][A-Z0-9_]{1,63}$/u.test(value) ? value : "UNEXPECTED_ERROR";
}
