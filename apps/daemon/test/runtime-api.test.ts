import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isLoomAcceptedCommandResponse,
  isLoomBacktestView,
  isLoomBlobRecord,
  isLoomPublishedViewDescriptor,
  isLoomSelectionCreatedPayload,
  type LoomAcceptedCommandResponse,
  LoomErrorResponseSchema,
  LoomEventsResponseSchema,
} from "@veilquant/loom-protocol";
import { Check } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLoomApp } from "../src/app.js";
import { SessionEventStoreRegistry } from "../src/event-store.js";
import { createDefaultRuntimeHost, type LoomRuntimeHost } from "../src/runtime-host.js";

const TEST_ORIGIN = "http://127.0.0.1:3000";

describe("Raw Pi command API", () => {
  let stateRoot: string;
  let eventStores: SessionEventStoreRegistry;
  let runtimeHost: LoomRuntimeHost;
  let app: ReturnType<typeof createLoomApp>;
  let headers: Record<string, string>;
  const sessions: string[] = [];

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-runtime-api-"));
    eventStores = new SessionEventStoreRegistry({ stateRoot });
    runtimeHost = host();
    app = createLoomApp({ eventStores, runtimeHost });
    headers = await authorizedHeaders(app);
  });

  afterEach(async () => {
    for (const sessionId of sessions) await runtimeHost.closeSession("project-a", sessionId);
    sessions.length = 0;
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("creates a Raw Pi session, accepts a message, and exposes completion through replay", async () => {
    const created = await command("/v0/projects/project-a/sessions", {
      format: "loom.session.create.v0",
      profile: "raw-pi",
      title: "API fixture",
    });
    expect(created.response.status).toBe(202);
    expect(isLoomAcceptedCommandResponse(created.body)).toBe(true);
    const createCommand = requireAccepted(created.body);
    sessions.push(createCommand.sessionId);

    const sent = await command(
      `/v0/sessions/${createCommand.sessionId}/messages?projectId=project-a`,
      { format: "loom.message.send.v0", content: "Inspect the fixture." },
    );
    expect(sent.response.status).toBe(202);
    const messageCommand = requireAccepted(sent.body);
    expect(messageCommand.taskId).toBeDefined();
    await runtimeHost.waitForIdle("project-a", createCommand.sessionId);

    const replay = await app.request(
      `/v0/sessions/${createCommand.sessionId}/events?projectId=project-a`,
      { headers },
    );
    const replayBody: unknown = await replay.json();
    expect(replay.status).toBe(200);
    expect(Check(LoomEventsResponseSchema, replayBody)).toBe(true);
    expect(replayBody).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "tool.completed" }),
        expect.objectContaining({
          type: "task.completed",
          payload: { taskId: messageCommand.taskId },
        }),
      ]),
    });
    if (!Check(LoomEventsResponseSchema, replayBody)) throw new Error("Expected replay events");
    const published = replayBody.events.find(
      (event) => event.type === "view.published" && isLoomPublishedViewDescriptor(event.payload),
    );
    if (published === undefined || !isLoomPublishedViewDescriptor(published.payload)) {
      throw new Error("Expected a published backtest view");
    }

    const viewResponse = await app.request(
      `/v0/views/${published.payload.viewId}?projectId=project-a&sessionId=${createCommand.sessionId}`,
      { headers },
    );
    const viewBody: unknown = await viewResponse.json();
    expect(viewResponse.status).toBe(200);
    expect(viewResponse.headers.get("cache-control")).toContain("immutable");
    expect(isLoomBacktestView(viewBody)).toBe(true);
    if (!isLoomBacktestView(viewBody) || viewBody.market === null) {
      throw new Error("Expected a market series reference");
    }
    const blobResponse = await app.request(
      `/v0/blobs/${viewBody.market.blobId}?projectId=project-a&sessionId=${createCommand.sessionId}&viewId=${viewBody.viewId}`,
      { headers },
    );
    expect(blobResponse.status).toBe(200);
    const marketRecord: unknown = await blobResponse.json();
    expect(isLoomBlobRecord(marketRecord)).toBe(true);
    if (
      !isLoomBlobRecord(marketRecord) ||
      marketRecord.content.format !== "loom.series.v0" ||
      marketRecord.content.kind !== "ohlcv"
    ) {
      throw new Error("Expected market points");
    }

    const selectionResponse = await command(
      `/v0/sessions/${createCommand.sessionId}/selections?projectId=project-a`,
      {
        format: "loom.selection.create.v0",
        viewId: viewBody.viewId,
        from: marketRecord.content.points[4]?.time,
        until: marketRecord.content.points[7]?.time,
        seriesKeys: ["equity", "drawdown", "trades"],
      },
    );
    expect(selectionResponse.response.status).toBe(202);
    const selectionCommand = requireAccepted(selectionResponse.body);
    expect(selectionCommand.selectionId).toMatch(/^selection_/);

    const asked = await command(
      `/v0/sessions/${createCommand.sessionId}/messages?projectId=project-a`,
      {
        format: "loom.message.send.v0",
        content: "Why did this interval draw down?",
        selectionId: selectionCommand.selectionId,
      },
    );
    expect(asked.response.status).toBe(202);
    await runtimeHost.waitForIdle("project-a", createCommand.sessionId);
    const finalEvents = await (
      await eventStores.get("project-a", createCommand.sessionId)
    ).replay();
    const selectionEvent = finalEvents.find(
      (event) => event.type === "selection.created" && isLoomSelectionCreatedPayload(event.payload),
    );
    expect(selectionEvent?.payload).toMatchObject({
      selection: { selectionId: selectionCommand.selectionId },
    });
    expect(finalEvents).toContainEqual(
      expect.objectContaining({
        type: "message.user_appended",
        payload: expect.objectContaining({
          content: "Why did this interval draw down?",
          selectionId: selectionCommand.selectionId,
        }),
      }),
    );
    expect(finalEvents.filter((event) => event.type === "view.published")).toHaveLength(1);

    const wrongSession = await app.request(
      `/v0/views/${viewBody.viewId}?projectId=project-a&sessionId=another-session`,
      { headers },
    );
    expect(wrongSession.status).toBe(404);
    expect(await wrongSession.json()).toMatchObject({ code: "VIEW_NOT_FOUND" });
  });

  it("rejects malformed commands and an unavailable Veil profile without leaking internals", async () => {
    const invalid = await command("/v0/projects/project-a/sessions", {
      format: "loom.session.create.v0",
      profile: "raw-pi",
      title: "   ",
    });
    expect(invalid.response.status).toBe(400);
    expect(Check(LoomErrorResponseSchema, invalid.body)).toBe(true);
    expect(invalid.body).toMatchObject({ code: "INVALID_REQUEST" });

    const oversized = await command("/v0/projects/project-a/sessions", {
      format: "loom.session.create.v0",
      profile: "raw-pi",
      title: "x".repeat(70_000),
    });
    expect(oversized.response.status).toBe(400);
    expect(oversized.body).toMatchObject({ code: "INVALID_REQUEST" });

    const unavailable = await command("/v0/projects/project-a/sessions", {
      format: "loom.session.create.v0",
      profile: "veil",
    });
    expect(unavailable.response.status).toBe(409);
    expect(unavailable.body).toMatchObject({ code: "PROFILE_UNAVAILABLE" });
    expect(JSON.stringify(unavailable.body)).not.toContain(stateRoot);

    const missing = await command("/v0/sessions/missing/messages?projectId=project-a", {
      format: "loom.message.send.v0",
      content: "Hello",
    });
    expect(missing.response.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("rejects browser-supplied summaries and unknown selection context", async () => {
    const injected = await command("/v0/sessions/session-a/selections?projectId=project-a", {
      format: "loom.selection.create.v0",
      viewId: `view_${"a".repeat(64)}`,
      from: { epoch: "1", unit: "ms" },
      until: { epoch: "2", unit: "ms" },
      seriesKeys: ["equity"],
      visibleSummary: [{ key: "forged", value: 99 }],
    });
    expect(injected.response.status).toBe(400);
    expect(injected.body).toMatchObject({ code: "INVALID_REQUEST" });

    const created = requireAccepted(
      (
        await command("/v0/projects/project-a/sessions", {
          format: "loom.session.create.v0",
          profile: "raw-pi",
        })
      ).body,
    );
    sessions.push(created.sessionId);
    const unknown = await command(
      `/v0/sessions/${created.sessionId}/messages?projectId=project-a`,
      {
        format: "loom.message.send.v0",
        content: "Inspect this.",
        selectionId: "selection_missing",
      },
    );
    expect(unknown.response.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: "SELECTION_NOT_FOUND" });
  });

  it("applies the daemon Origin and cookie gate before any mutation", async () => {
    const body = JSON.stringify({ format: "loom.session.create.v0", profile: "raw-pi" });
    const missingCookie = await app.request("/v0/projects/project-a/sessions", {
      method: "POST",
      headers: { Origin: TEST_ORIGIN, "Content-Type": "application/json" },
      body,
    });
    expect(missingCookie.status).toBe(401);
    expect(await missingCookie.json()).toMatchObject({ code: "AUTH_REQUIRED" });

    const wrongOrigin = await app.request("/v0/projects/project-a/sessions", {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.example", "Content-Type": "application/json" },
      body,
    });
    expect(wrongOrigin.status).toBe(403);
    expect(await wrongOrigin.json()).toMatchObject({ code: "ORIGIN_FORBIDDEN" });
    await expect((await eventStores.get("project-a", "session-1")).replay()).resolves.toHaveLength(
      0,
    );
  });

  it("accepts cancellation as a separate command and reports the terminal event", async () => {
    runtimeHost = host({ tokensPerSecond: 100, preamble: "C".repeat(400) });
    app = createLoomApp({ eventStores, runtimeHost });
    headers = await authorizedHeaders(app);
    const created = requireAccepted(
      (
        await command("/v0/projects/project-a/sessions", {
          format: "loom.session.create.v0",
          profile: "raw-pi",
        })
      ).body,
    );
    sessions.push(created.sessionId);
    const sent = requireAccepted(
      (
        await command(`/v0/sessions/${created.sessionId}/messages?projectId=project-a`, {
          format: "loom.message.send.v0",
          content: "Start a paced response.",
        })
      ).body,
    );
    if (sent.taskId === undefined) throw new Error("Message command has no task ID");

    const cancelled = await command(
      `/v0/sessions/${created.sessionId}/tasks/${sent.taskId}/cancel?projectId=project-a`,
      { format: "loom.task.cancel.v0" },
    );
    expect(cancelled.response.status).toBe(202);
    expect(cancelled.body).toMatchObject({ taskId: sent.taskId });
    await runtimeHost.waitForIdle("project-a", created.sessionId);
    const events = await (await eventStores.get("project-a", created.sessionId)).replay();
    expect(events.map((event) => event.type)).toContain("task.cancelled");
    expect(events.map((event) => event.type)).not.toContain("task.completed");
  });

  function host(fixture?: Parameters<typeof createDefaultRuntimeHost>[0]["fixture"]) {
    return createDefaultRuntimeHost({
      eventStores,
      cwd: stateRoot,
      agentDir: join(stateRoot, "pi"),
      ...(fixture === undefined ? {} : { fixture }),
    });
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

function requireAccepted(input: unknown): LoomAcceptedCommandResponse {
  if (!isLoomAcceptedCommandResponse(input)) throw new Error("Expected an accepted command");
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
