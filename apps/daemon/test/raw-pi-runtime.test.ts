import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoomEventEnvelope, LoomSelection } from "@veilquant/loom-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionEventStoreRegistry } from "../src/event-store.js";
import { publishedViewFromToolResult } from "../src/pi/loom-extension.js";
import {
  buildPiPrompt,
  RawPiRuntimeAdapter,
  type RuntimeAdapterError,
} from "../src/runtime-adapter.js";
import { createDefaultRuntimeHost, LoomRuntimeHost } from "../src/runtime-host.js";

describe("Raw Pi runtime adapter", () => {
  let stateRoot: string;
  let eventStores: SessionEventStoreRegistry;
  let eventNumber: number;
  const sessions: Array<{ host: LoomRuntimeHost; projectId: string; sessionId: string }> = [];

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-pi-runtime-"));
    eventNumber = 0;
    eventStores = new SessionEventStoreRegistry({
      stateRoot,
      clock: () => "2026-08-18T01:00:00.000Z",
      eventId: () => `evt_pi_${++eventNumber}`,
    });
  });

  afterEach(async () => {
    for (const entry of sessions) {
      await entry.host.closeSession(entry.projectId, entry.sessionId);
    }
    vi.restoreAllMocks();
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("maps an offline Pi prompt, extension tool, and response into public durable events", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const fixture = await session();

    await fixture.host.sendMessage(
      {
        projectId: fixture.projectId,
        sessionId: fixture.sessionId,
        content: "Inspect the fixture.",
      },
      { commandId: "command-message-1", taskId: "task-1", messageId: "user-1" },
    );
    await fixture.host.waitForIdle(fixture.projectId, fixture.sessionId);
    const events = await fixture.events();

    expect(fetch).not.toHaveBeenCalled();
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(events[0]).toMatchObject({
      type: "session.created",
      payload: {
        profile: "raw-pi",
        assurance: { state: "exploratory", issuer: "loom", evidenceRefs: [] },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.ready",
        payload: expect.objectContaining({
          runtime: {
            format: "loom.pi-runtime.v0",
            package: "@earendil-works/pi-coding-agent",
            version: "0.84.2",
            provider: "loom-offline-fixture",
            model: "loom-fixture-v0",
            mode: "offline-fixture",
            fingerprint: "pi-0.84.2__loom-offline-fixture__loom-fixture-v0",
          },
        }),
      }),
    );
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "view.published")).toHaveLength(1);
    expect(events.findIndex((event) => event.type === "tool.completed")).toBeLessThan(
      events.findIndex((event) => event.type === "view.published"),
    );
    expect(events.findIndex((event) => event.type === "view.published")).toBeLessThan(
      events.findIndex((event) => event.type === "task.completed"),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task.completed", payload: { taskId: "task-1" } }),
    );
    expect(assistantDeltasMatch(events)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("deterministic thought");
    expect(JSON.stringify(events)).not.toContain("arguments");
    expect(JSON.stringify(events)).not.toContain("committed daily-factor reference view is ready");
    expect(JSON.stringify(events)).not.toContain("1704153600000");
  });

  it("adds only a portable daemon summary to a selection-aware Pi prompt", () => {
    const selection: LoomSelection = {
      format: "loom.selection.v0",
      selectionId: "selection_one",
      projectId: "project-a",
      sessionId: "session-a",
      viewId: `view_${"a".repeat(64)}`,
      from: { epoch: "1700000000000", unit: "ms" },
      until: { epoch: "1700086400000", unit: "ms" },
      seriesKeys: ["drawdown"],
      visibleSummary: [
        {
          key: "selection.max_drawdown",
          label: "Maximum drawdown",
          value: -0.02,
          unit: "ratio",
          scale: "percent",
          sampleScope: "selection",
          method: {
            id: "selected_range.v0",
            description: "Lowest drawdown observation in the selected range.",
          },
        },
      ],
      createdAt: "2026-08-18T00:00:00.000Z",
    };
    const prompt = buildPiPrompt("Why did this draw down?", selection);
    expect(prompt).toContain("loom.selection-context.v0");
    expect(prompt).toContain(selection.selectionId);
    expect(prompt).toContain(selection.viewId);
    expect(prompt).toContain("Why did this draw down?");
    expect(prompt).not.toContain("project-a");
    expect(prompt).not.toContain("session-a");
    expect(prompt).not.toContain('"points"');
    expect(prompt).not.toContain('"trades"');
    expect(buildPiPrompt("Plain request", undefined)).toBe("Plain request");
  });

  it("cancels a paced provider through Pi's AbortSignal without reporting completion", async () => {
    const fixture = await session({ tokensPerSecond: 100, preamble: "A".repeat(400) });
    await fixture.host.sendMessage(
      { projectId: fixture.projectId, sessionId: fixture.sessionId, content: "Start." },
      { commandId: "command-message-2", taskId: "task-2", messageId: "user-2" },
    );

    const accepted = await fixture.host.cancelTask(
      { projectId: fixture.projectId, sessionId: fixture.sessionId, taskId: "task-2" },
      "command-cancel-2",
    );
    expect(accepted).toMatchObject({ commandId: "command-cancel-2", taskId: "task-2" });
    await fixture.host.waitForIdle(fixture.projectId, fixture.sessionId);
    const events = await fixture.events();

    expect(events.map((event) => event.type)).toContain("task.cancel_requested");
    expect(events.map((event) => event.type)).toContain("task.cancelled");
    expect(events.map((event) => event.type)).not.toContain("task.completed");
    expect(events.at(-1)).toMatchObject({
      type: "session.status_changed",
      payload: { status: "ready" },
    });
  });

  it("redacts provider failures and keeps the session ready for a retry", async () => {
    const fixture = await session({ outcome: "error" });
    await fixture.host.sendMessage(
      { projectId: fixture.projectId, sessionId: fixture.sessionId, content: "Fail safely." },
      { commandId: "command-message-3", taskId: "task-3", messageId: "user-3" },
    );
    await fixture.host.waitForIdle(fixture.projectId, fixture.sessionId);
    const events = await fixture.events();
    const serialized = JSON.stringify(events);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task.failed",
        payload: expect.objectContaining({ taskId: "task-3", code: "PI_RUN_FAILED" }),
      }),
    );
    expect(serialized).not.toContain("Private fixture failure");
    expect(serialized).not.toContain("provider diagnostics");
    expect(events.at(-1)).toMatchObject({ payload: { status: "ready" } });
  });

  it("rejects a second prompt while the first task owns the session", async () => {
    const fixture = await session({ tokensPerSecond: 100, preamble: "B".repeat(400) });
    await fixture.host.sendMessage(
      { projectId: fixture.projectId, sessionId: fixture.sessionId, content: "First." },
      { commandId: "command-first", taskId: "task-first", messageId: "user-first" },
    );

    await expect(
      fixture.host.sendMessage(
        { projectId: fixture.projectId, sessionId: fixture.sessionId, content: "Second." },
        { commandId: "command-second", taskId: "task-second", messageId: "user-second" },
      ),
    ).rejects.toMatchObject({ code: "SESSION_BUSY" } satisfies Partial<RuntimeAdapterError>);
    await fixture.host.cancelTask(
      { projectId: fixture.projectId, sessionId: fixture.sessionId, taskId: "task-first" },
      "command-cancel-first",
    );
    await fixture.host.waitForIdle(fixture.projectId, fixture.sessionId);
  });

  it("records a stable failed state when Pi cannot start without publishing diagnostics", async () => {
    const adapter = new RawPiRuntimeAdapter({
      eventStores,
      cwd: stateRoot,
      agentDir: join(stateRoot, "pi"),
      sessionFactory: {
        create: async () => {
          throw new Error(`Private provider failure at ${stateRoot}/credential.json`);
        },
      },
    });
    const host = new LoomRuntimeHost({ adapters: [adapter], eventStores });

    await expect(
      host.createSession(
        { projectId: "project-a", profile: "raw-pi" },
        { sessionId: "failed-session", commandId: "failed-create" },
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_UNAVAILABLE" });
    const events = await (await eventStores.get("project-a", "failed-session")).replay();
    expect(events.at(-1)).toMatchObject({
      type: "session.status_changed",
      payload: { status: "failed", code: "PI_START_FAILED" },
    });
    expect(JSON.stringify(events)).not.toContain(stateRoot);
    expect(JSON.stringify(events)).not.toContain("credential.json");
  });

  it("does not promote an arbitrary tool result into a published view", () => {
    expect(
      publishedViewFromToolResult({
        details: {
          view: {
            viewId: `view_${"a".repeat(64)}`,
            kind: "backtest",
            assurance: { state: "accepted" },
          },
        },
      }),
    ).toBeUndefined();
  });

  async function session(fixture?: Parameters<typeof createDefaultRuntimeHost>[0]["fixture"]) {
    const host = createDefaultRuntimeHost({
      eventStores,
      cwd: stateRoot,
      agentDir: join(stateRoot, "pi"),
      ...(fixture === undefined ? {} : { fixture }),
    });
    const projectId = "project-a";
    const sessionId = `session-${sessions.length + 1}`;
    await host.createSession(
      { projectId, profile: "raw-pi", title: "Runtime test" },
      { sessionId, commandId: `command-create-${sessions.length + 1}` },
    );
    sessions.push({ host, projectId, sessionId });
    const store = await eventStores.get(projectId, sessionId);
    return { host, projectId, sessionId, events: () => store.replay() };
  }
});

function assistantDeltasMatch(events: readonly LoomEventEnvelope[]): boolean {
  const deltas = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "message.assistant_delta") continue;
    const id = event.payload.messageId;
    const delta = event.payload.delta;
    if (typeof id !== "string" || typeof delta !== "string") return false;
    deltas.set(id, `${deltas.get(id) ?? ""}${delta}`);
  }
  return events
    .filter((event) => event.type === "message.assistant_completed")
    .every(
      (event) =>
        typeof event.payload.messageId === "string" &&
        deltas.get(event.payload.messageId) === event.payload.content,
    );
}
