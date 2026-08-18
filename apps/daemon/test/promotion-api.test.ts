import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  isLoomPromotionAcceptedResponse,
  isLoomVeilExperimentRecordedPayload,
  isLoomVeilVerificationStartedPayload,
  type LoomPromotionAcceptedResponse,
} from "@veilquant/loom-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLoomApp } from "../src/app.js";
import { SessionEventStoreRegistry } from "../src/event-store.js";
import { LoomProjectRegistry } from "../src/project-readiness.js";
import { DAILY_FACTOR_IMPORT } from "../src/reference-backtest/daily-factor-fixture.js";
import { DailyFactorReferenceAdapter } from "../src/reference-backtest/reference-adapter.js";
import { ResearchArtifactStore } from "../src/research-artifacts.js";
import { createDefaultRuntimeHost, type LoomRuntimeHost } from "../src/runtime-host.js";
import { loadVeilPublicApi } from "../src/veil-api.js";

const TEST_ORIGIN = "http://127.0.0.1:3000";
const EXAMPLE_ROOT = resolve(import.meta.dirname, "../../../examples/daily-factor");

describe("Raw to Veil promotion API", () => {
  let temporaryRoot: string;
  let projectRoot: string;
  let stateRoot: string;
  let eventStores: SessionEventStoreRegistry;
  let artifacts: ResearchArtifactStore;
  let runtimeHost: LoomRuntimeHost;
  let app: ReturnType<typeof createLoomApp>;
  let headers: Record<string, string>;
  const sessions: string[] = [];

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "veil-loom-promotion-api-"));
    projectRoot = join(temporaryRoot, "project");
    stateRoot = join(temporaryRoot, "state");
    await cp(EXAMPLE_ROOT, projectRoot, { recursive: true });
    eventStores = new SessionEventStoreRegistry({ stateRoot });
    artifacts = new ResearchArtifactStore({ stateRoot });
    const projects = new LoomProjectRegistry({
      registrations: [{ projectId: "daily-factor", root: projectRoot }],
    });
    runtimeHost = createDefaultRuntimeHost({
      eventStores,
      artifacts,
      cwd: projectRoot,
      agentDir: join(stateRoot, "pi"),
      projects,
    });
    app = createLoomApp({ eventStores, artifacts, runtimeHost });
    headers = await authorizedHeaders(app);
  });

  afterEach(async () => {
    for (const sessionId of sessions) {
      await runtimeHost.closeSession("daily-factor", sessionId);
    }
    sessions.length = 0;
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("creates a separate Veil attempt and projects only an independently verified archive", async () => {
    const source = await seedRawView();
    const sourceBefore = await sourceEvents(source.sessionId);
    const promoted = await command(
      `/v0/sessions/${source.sessionId}/promotions?projectId=daily-factor`,
      {
        format: "loom.promotion.create.v0",
        viewId: source.viewId,
        artifactReference: "artifact/daily-factor.mjs",
        hypothesis: {
          statement:
            "The strongest cross-sectional price trend remains positive out of sample after costs.",
        },
      },
    );
    expect(promoted.response.status).toBe(202);
    const receipt = requirePromotionReceipt(promoted.body);
    sessions.push(receipt.sessionId);
    expect(receipt.sourceSessionId).toBe(source.sessionId);
    expect(receipt.sessionId).not.toBe(source.sessionId);

    await runtimeHost.waitForIdle("daily-factor", receipt.sessionId);
    const target = await sourceEvents(receipt.sessionId);
    const sourceAfter = await sourceEvents(source.sessionId);
    expect(sourceAfter).toEqual(sourceBefore);
    expect(target[0]).toMatchObject({
      type: "session.created",
      payload: {
        profile: "veil",
        assurance: { state: "exploratory", issuer: "loom", evidenceRefs: [] },
      },
    });
    const started = target.find((event) => event.type === "veil.verification_started");
    expect(isLoomVeilVerificationStartedPayload(started?.payload)).toBe(true);
    expect(started?.payload).toMatchObject({
      relation: "derived-from-exploration",
      source: { sessionId: source.sessionId, viewId: source.viewId },
      artifact: { reference: "artifact/daily-factor.mjs" },
    });
    const experiment = target.find((event) => event.type === "veil.experiment_recorded");
    expect(isLoomVeilExperimentRecordedPayload(experiment?.payload)).toBe(true);
    if (!isLoomVeilExperimentRecordedPayload(experiment?.payload)) {
      throw new Error("Expected a verified Experiment projection");
    }
    expect(experiment.payload).toMatchObject({
      registrationStatus: "preregistered",
      verdict: "rejected",
      claimStatus: "rejected",
      assurance: { state: "rejected", issuer: "veil" },
    });
    expect(target).toContainEqual(
      expect.objectContaining({
        type: "task.completed",
        payload: { taskId: receipt.taskId },
      }),
    );
    expect(target.filter((event) => event.type === "task.failed")).toHaveLength(0);

    const veil = await loadVeilPublicApi();
    const archive = await veil.api.loadProjectExperiment(
      projectRoot,
      experiment.payload.experimentId,
    );
    expect(archive.archiveHash).toBe(experiment.payload.archiveHash);
    expect(archive.execution.experiment.experimentId).toBe(experiment.payload.experimentId);

    const request = await readFile(
      join(projectRoot, ".veil", "loom-attempts", `${receipt.attemptId}.yaml`),
      "utf8",
    );
    expect(request).toContain("format: veil.promotion-request.v0");
    expect(request).toContain("development_read_sets:");
    expect(request).not.toMatch(/sharpe|equity|total_return|expected_result|raw_metric/i);
    const serialized = JSON.stringify(target);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain("veil-prices.csv");
    expect(serialized).not.toContain(".veil/experiments");
  }, 60_000);

  it("rejects metric injection and artifact mismatch before creating a target session", async () => {
    const source = await seedRawView();
    const before = await sourceEvents(source.sessionId);
    const injected = await command(
      `/v0/sessions/${source.sessionId}/promotions?projectId=daily-factor`,
      {
        format: "loom.promotion.create.v0",
        viewId: source.viewId,
        artifactReference: "artifact/daily-factor.mjs",
        hypothesis: { statement: "A valid hypothesis." },
        metrics: { sharpe: 99 },
      },
    );
    expect(injected.response.status).toBe(400);
    expect(injected.body).toMatchObject({ code: "INVALID_REQUEST" });

    const mismatch = await command(
      `/v0/sessions/${source.sessionId}/promotions?projectId=daily-factor`,
      {
        format: "loom.promotion.create.v0",
        viewId: source.viewId,
        artifactReference: "source/factor.mjs",
        hypothesis: { statement: "A valid hypothesis." },
      },
    );
    expect(mismatch.response.status).toBe(409);
    expect(mismatch.body).toMatchObject({ code: "PROMOTION_NOT_AVAILABLE" });
    expect(await sourceEvents(source.sessionId)).toEqual(before);
    await expect(eventStores.discover()).resolves.toHaveLength(1);
  });

  it("keeps an artifact execution failure distinct from a rejected Experiment", async () => {
    const source = await seedRawView();
    const badReference = "artifact/failing-factor.mjs";
    const badBytes = 'export function compute() { throw new Error("private failure"); }\n';
    await writeFile(join(projectRoot, ...badReference.split("/")), badBytes, "utf8");
    const candidate = structuredClone(DAILY_FACTOR_IMPORT) as unknown as {
      source: { artifactDigest: string };
    };
    candidate.source.artifactDigest = `sha256:${createHash("sha256").update(badBytes).digest("hex")}`;
    const taskId = "failing-view-task";
    const store = await eventStores.get("daily-factor", source.sessionId);
    await store.append({ type: "task.started", payload: { taskId, label: "Failing fixture" } });
    const descriptor = await new DailyFactorReferenceAdapter(artifacts).publish(candidate, {
      projectId: "daily-factor",
      sessionId: source.sessionId,
      taskId,
    });
    await store.append({ type: "view.published", payload: descriptor });
    await store.append({ type: "task.completed", payload: { taskId } });
    const sourceBefore = await store.replay();

    const promoted = await command(
      `/v0/sessions/${source.sessionId}/promotions?projectId=daily-factor`,
      {
        format: "loom.promotion.create.v0",
        viewId: descriptor.viewId,
        artifactReference: badReference,
        hypothesis: { statement: "This deliberately failing artifact should issue no claim." },
      },
    );
    const receipt = requirePromotionReceipt(promoted.body);
    sessions.push(receipt.sessionId);
    await runtimeHost.waitForIdle("daily-factor", receipt.sessionId);
    const target = await sourceEvents(receipt.sessionId);
    expect(target).toContainEqual(
      expect.objectContaining({
        type: "task.failed",
        payload: expect.objectContaining({
          taskId: receipt.taskId,
          code: "VEIL_VERIFICATION_FAILED",
        }),
      }),
    );
    expect(target.filter((event) => event.type === "veil.experiment_recorded")).toHaveLength(0);
    expect(JSON.stringify(target)).not.toContain('"state":"rejected"');
    expect(await store.replay()).toEqual(sourceBefore);
  });

  it("cancels the new Veil task without issuing an Experiment", async () => {
    const source = await seedRawView();
    const promoted = await command(
      `/v0/sessions/${source.sessionId}/promotions?projectId=daily-factor`,
      {
        format: "loom.promotion.create.v0",
        viewId: source.viewId,
        artifactReference: "artifact/daily-factor.mjs",
        hypothesis: { statement: "Cancel this independent verification attempt." },
      },
    );
    const receipt = requirePromotionReceipt(promoted.body);
    sessions.push(receipt.sessionId);
    const cancelled = await command(
      `/v0/sessions/${receipt.sessionId}/tasks/${receipt.taskId}/cancel?projectId=daily-factor`,
      { format: "loom.task.cancel.v0" },
    );
    expect(cancelled.response.status).toBe(202);
    await runtimeHost.waitForIdle("daily-factor", receipt.sessionId);
    const target = await sourceEvents(receipt.sessionId);
    expect(target).toContainEqual(
      expect.objectContaining({ type: "task.cancelled", payload: { taskId: receipt.taskId } }),
    );
    expect(target.filter((event) => event.type === "veil.experiment_recorded")).toHaveLength(0);
  });

  async function seedRawView(): Promise<{ sessionId: string; viewId: string }> {
    const created = await command("/v0/projects/daily-factor/sessions", {
      format: "loom.session.create.v0",
      profile: "raw-pi",
    });
    if (
      created.body === null ||
      typeof created.body !== "object" ||
      !("sessionId" in created.body) ||
      typeof created.body.sessionId !== "string"
    ) {
      throw new Error("Expected a Raw session receipt");
    }
    const sessionId = created.body.sessionId;
    sessions.push(sessionId);
    const sent = await command(`/v0/sessions/${sessionId}/messages?projectId=daily-factor`, {
      format: "loom.message.send.v0",
      content: "Publish the committed daily-factor view.",
    });
    expect(sent.response.status).toBe(202);
    await runtimeHost.waitForIdle("daily-factor", sessionId);
    const published = (await sourceEvents(sessionId)).find(
      (event) => event.type === "view.published" && typeof event.payload.viewId === "string",
    );
    if (published === undefined || typeof published.payload.viewId !== "string") {
      throw new Error("Expected a published Raw view");
    }
    return { sessionId, viewId: published.payload.viewId };
  }

  async function sourceEvents(sessionId: string) {
    return (await eventStores.get("daily-factor", sessionId)).replay();
  }

  async function command(path: string, body: unknown) {
    const response = await app.request(path, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { response, body: (await response.json()) as unknown };
  }
});

function requirePromotionReceipt(input: unknown): LoomPromotionAcceptedResponse {
  if (!isLoomPromotionAcceptedResponse(input)) throw new Error("Expected a promotion receipt");
  return input;
}

async function authorizedHeaders(
  app: ReturnType<typeof createLoomApp>,
): Promise<Record<string, string>> {
  const response = await app.request("/v0/auth/bootstrap", {
    method: "POST",
    headers: { Origin: TEST_ORIGIN },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Bootstrap did not issue a session cookie");
  return { Origin: TEST_ORIGIN, Cookie: setCookie.split(";", 1)[0] ?? "" };
}
