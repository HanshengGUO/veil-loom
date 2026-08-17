import { VEIL_PROFILE } from "@veilquant/loom-protocol";
import { describe, expect, it, vi } from "vitest";
import {
  type LoadProjectReadinessOptions,
  loadProjectReadiness,
} from "../src/lib/project-readiness";

const DAEMON_ORIGIN = "http://127.0.0.1:43120";

describe("project readiness client", () => {
  it("loads an exact readiness summary after authorization", async () => {
    const authorize = vi.fn(async () => undefined);
    const fetchPort = vi.fn(async () => jsonResponse(ready()));

    await expect(loadProjectReadiness(options(fetchPort, authorize))).resolves.toEqual(ready());
    expect(authorize).toHaveBeenCalledOnce();
    expect(fetchPort).toHaveBeenCalledWith(
      `${DAEMON_ORIGIN}/v0/projects/daily-factor-demo`,
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
      }),
    );
  });

  it("accepts a bounded non-ready diagnostic", async () => {
    const response = {
      format: "loom.project-readiness.v0",
      projectId: "daily-factor-demo",
      profile: "veil",
      status: "invalid",
      runtime: ready().runtime,
      capabilities: [],
      issue: {
        code: "VEIL_PROJECT_INVALID",
        message: "The project declaration is invalid.",
        remedy: "Correct the declaration and retry.",
      },
    } as const;
    await expect(
      loadProjectReadiness(options(async () => jsonResponse(response))),
    ).resolves.toEqual(response);
  });

  it("fails closed on forged ownership, extra fields, malformed JSON, and oversized data", async () => {
    const forged = { ...ready(), projectId: "another-project" };
    await expect(loadProjectReadiness(options(async () => jsonResponse(forged)))).rejects.toThrow(
      "unsupported project readiness",
    );
    await expect(
      loadProjectReadiness(options(async () => jsonResponse({ ...ready(), root: "/private" }))),
    ).rejects.toThrow("unsupported project readiness");
    await expect(
      loadProjectReadiness(options(async () => new Response("not-json", { status: 200 }))),
    ).rejects.toThrow("malformed project readiness");
    await expect(
      loadProjectReadiness(
        options(
          async () =>
            new Response(JSON.stringify(ready()), {
              status: 200,
              headers: { "Content-Length": "20000" },
            }),
        ),
      ),
    ).rejects.toThrow("size limit");
  });

  it("rejects path-like project identifiers before making a request", async () => {
    const fetchPort = vi.fn(async () => jsonResponse(ready()));
    await expect(
      loadProjectReadiness({
        ...options(fetchPort),
        projectId: "../private",
      }),
    ).rejects.toThrow("project identifier is invalid");
    expect(fetchPort).not.toHaveBeenCalled();
  });
});

function options(
  fetchPort: NonNullable<LoadProjectReadinessOptions["fetchPort"]>,
  authorize: () => Promise<void> = async () => undefined,
): LoadProjectReadinessOptions {
  return {
    daemonOrigin: DAEMON_ORIGIN,
    projectId: "daily-factor-demo",
    fetchPort,
    authorize,
  };
}

function ready() {
  return {
    format: "loom.project-readiness.v0",
    projectId: "daily-factor-demo",
    profile: "veil",
    status: "ready",
    runtime: {
      package: "veil-quant",
      installedVersion: "0.1.0",
      supportedRange: ">=0.1.0 <0.2.0",
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
  } as const;
}

function jsonResponse(input: unknown): Response {
  return new Response(JSON.stringify(input), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
