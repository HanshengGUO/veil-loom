import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parse, resolve } from "node:path";
import { isLoomProjectReadinessResponse, VEIL_PROFILE } from "@veilquant/loom-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type LoomProjectRegistration, LoomProjectRegistry } from "../src/project-readiness.js";
import {
  type LoadedVeilApi,
  VEIL_SUPPORTED_RANGE,
  VeilApiLoadError,
  type VeilProject,
} from "../src/veil-api.js";

const EXAMPLE_ROOT = resolve(import.meta.dirname, "../../../examples/daily-factor");

describe("Veil project readiness", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("loads the committed project through the supported public Veil package", async () => {
    const registry = registered({ projectId: "daily-factor-demo", root: EXAMPLE_ROOT });
    const readiness = await registry.readiness("daily-factor-demo");

    expect(isLoomProjectReadinessResponse(readiness)).toBe(true);
    expect(readiness).toEqual({
      format: "loom.project-readiness.v0",
      projectId: "daily-factor-demo",
      profile: "veil",
      status: "ready",
      runtime: {
        package: "veil-quant",
        installedVersion: "0.1.0",
        supportedRange: VEIL_SUPPORTED_RANGE,
        detectedFormats: ["veil.project.v0"],
      },
      capabilities: [...VEIL_PROFILE.capabilities],
      project: {
        format: "veil.project.v0",
        datasetCount: 1,
        runtimeCount: 1,
        promotionConcurrency: 2,
        costModelCount: 1,
        nullGeneratorCount: 1,
      },
    });
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain(EXAMPLE_ROOT);
    expect(serialized).not.toContain("adapter.yaml");
    expect(serialized).not.toContain("veil-prices.csv");
    expect(serialized).not.toContain("daily-factor-prices");

    const context = await registry.requireVeilProject("daily-factor-demo");
    expect(context.root).toBe(EXAMPLE_ROOT);
    expect(context.project.datasets.size).toBe(1);
  });

  it("reports invalid and unregistered projects without exposing host paths", async () => {
    const emptyRoot = await temporaryRoot();
    const registry = registered({ projectId: "invalid-project", root: emptyRoot });

    const invalid = await registry.readiness("invalid-project");
    expect(isLoomProjectReadinessResponse(invalid)).toBe(true);
    expect(invalid).toMatchObject({
      status: "invalid",
      capabilities: [],
      issue: { code: expect.stringMatching(/^[A-Z][A-Z0-9_]*$/) },
    });
    expect(JSON.stringify(invalid)).not.toContain(emptyRoot);
    await expect(registry.requireVeilProject("invalid-project")).rejects.toMatchObject({
      code: "PROJECT_NOT_READY",
    });

    const unregistered = await registry.readiness("another-project");
    expect(unregistered).toMatchObject({
      status: "unavailable",
      capabilities: [],
      issue: { code: "PROJECT_NOT_REGISTERED" },
    });
    expect(JSON.stringify(unregistered)).not.toContain(emptyRoot);
  });

  it("rejects a filesystem root and an unsupported Veil release", async () => {
    const rootRegistry = registered({
      projectId: "root-project",
      root: parse(EXAMPLE_ROOT).root,
    });
    await expect(rootRegistry.readiness("root-project")).resolves.toMatchObject({
      status: "unavailable",
      issue: { code: "PROJECT_ROOT_UNAVAILABLE" },
    });

    const versionError = new VeilApiLoadError(
      "VEIL_VERSION_UNSUPPORTED",
      "The installed Veil version is outside Loom's tested minor range.",
      `Install veil-quant ${VEIL_SUPPORTED_RANGE} and restart the daemon.`,
      "0.2.0",
    );
    const versionRegistry = new LoomProjectRegistry({
      registrations: [{ projectId: "daily-factor-demo", root: EXAMPLE_ROOT }],
      veilApiLoader: async () => Promise.reject(versionError),
    });
    await expect(versionRegistry.readiness("daily-factor-demo")).resolves.toEqual({
      format: "loom.project-readiness.v0",
      projectId: "daily-factor-demo",
      profile: "veil",
      status: "unavailable",
      runtime: {
        package: "veil-quant",
        installedVersion: "0.2.0",
        supportedRange: VEIL_SUPPORTED_RANGE,
        detectedFormats: [],
      },
      capabilities: [],
      issue: {
        code: "VEIL_VERSION_UNSUPPORTED",
        message: "The installed Veil version is outside Loom's tested minor range.",
        remedy: `Install veil-quant ${VEIL_SUPPORTED_RANGE} and restart the daemon.`,
      },
    });
  });

  it("bounds a malformed upstream diagnostic at the daemon boundary", async () => {
    const temporary = await temporaryRoot();
    const canonicalRoot = resolve(temporary, "canonical-project");
    const projectRoot = resolve(temporary, "project-alias");
    await mkdir(canonicalRoot);
    await symlink(canonicalRoot, projectRoot, process.platform === "win32" ? "junction" : "dir");
    const veil = fakeVeilApi(
      projectRoot,
      undefined,
      `Invalid declarations at ${projectRoot}/.veil/project.yaml and ${canonicalRoot}/.veil/project.yaml`,
    );
    const registry = new LoomProjectRegistry({
      registrations: [{ projectId: "diagnostic-project", root: projectRoot }],
      veilApiLoader: async () => veil,
    });

    const readiness = await registry.readiness("diagnostic-project");
    expect(readiness).toMatchObject({
      status: "invalid",
      issue: {
        code: "UNEXPECTED_ERROR",
        message:
          "Invalid declarations at [project]/.veil/project.yaml and [project]/.veil/project.yaml",
      },
    });
    expect(JSON.stringify(readiness)).not.toContain(projectRoot);
    expect(JSON.stringify(readiness)).not.toContain(canonicalRoot);
    expect(readiness.issue?.remedy.length).toBe(1_024);

    const wrongOwner = fakeVeilApi(projectRoot, {
      root: `${projectRoot}-other`,
      datasets: new Map([["dataset", {}]]),
      runtimes: { list: () => [{}] },
      promotionConcurrency: 1,
    });
    const ownershipRegistry = new LoomProjectRegistry({
      registrations: [{ projectId: "ownership-project", root: projectRoot }],
      veilApiLoader: async () => wrongOwner,
    });
    await expect(ownershipRegistry.readiness("ownership-project")).resolves.toMatchObject({
      status: "invalid",
      capabilities: [],
    });
  });

  async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "veil-loom-readiness-"));
    temporaryRoots.push(root);
    return root;
  }
});

function registered(registration: LoomProjectRegistration): LoomProjectRegistry {
  return new LoomProjectRegistry({ registrations: [registration] });
}

function fakeVeilApi(
  projectRoot: string,
  project?: VeilProject,
  diagnosticMessage = `Invalid declaration at ${projectRoot}/.veil/project.yaml`,
): LoadedVeilApi {
  return {
    version: "0.1.0",
    api: {
      loadVeilProject:
        project === undefined
          ? async () => Promise.reject(new Error("invalid"))
          : async () => project,
      createVeilExtension: () => () => undefined,
      describeVeilError: () => ({
        ok: false,
        code: "../../private",
        message: diagnosticMessage,
        remedy: "x".repeat(2_000),
      }),
      createHypothesisEntry: () => {
        throw new Error("unused");
      },
      executeVeilDataTool: async () => {
        throw new Error("unused");
      },
      executeVeilBacktestTool: async () => {
        throw new Error("unused");
      },
      loadProjectExperiment: async () => {
        throw new Error("unused");
      },
      reproduceProjectExperiment: async () => {
        throw new Error("unused");
      },
      VEIL_PROJECT_FORMAT: "veil.project.v0",
      VEIL_HYPOTHESIS_ENTRY: "veil.hypothesis.v0",
      VEIL_DATA_TOOL: "veil-data",
      VEIL_BACKTEST_TOOL: "veil-backtest",
      VEIL_MEMORY_TOOL: "veil-memory",
    },
  };
}
