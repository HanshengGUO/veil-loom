import { isLoomPublishedViewDescriptor, type LoomEventEnvelope } from "@veilquant/loom-protocol";
import type { SessionEventStore, SessionEventStoreRegistry } from "./event-store.js";
import {
  LOOM_FIXTURE_FINAL,
  LOOM_FIXTURE_MODEL,
  LOOM_FIXTURE_PREAMBLE,
  LOOM_FIXTURE_PROVIDER,
} from "./pi/deterministic-session.js";
import { LOOM_REFERENCE_BACKTEST_TOOL_NAME } from "./pi/loom-extension.js";
import type { LoomRuntimeHost } from "./runtime-host.js";

export const DEMO_PROJECT_ID = "daily-factor-demo";
export const DEMO_SESSION_ID = "raw-pi-demo";
export const DEMO_TASK_ID = "demo-task-1";
export const DEMO_MESSAGE =
  "Inspect the committed daily-factor fixture through the offline Raw Pi host.";

/** Creates the demo through the real Pi host once, then validates and replays its durable output. */
export async function seedDemoSession(
  eventStores: SessionEventStoreRegistry,
  runtimeHost: LoomRuntimeHost,
): Promise<SessionEventStore> {
  const store = await eventStores.get(DEMO_PROJECT_ID, DEMO_SESSION_ID);
  const existing = await store.replay();

  if (existing.length === 0) {
    await runtimeHost.createSession(
      {
        projectId: DEMO_PROJECT_ID,
        profile: "raw-pi",
        title: "Daily factor · offline Pi fixture",
      },
      { sessionId: DEMO_SESSION_ID, commandId: "demo-create-1" },
    );
    await runtimeHost.sendMessage(
      {
        projectId: DEMO_PROJECT_ID,
        sessionId: DEMO_SESSION_ID,
        content: DEMO_MESSAGE,
      },
      { commandId: "demo-message-1", taskId: DEMO_TASK_ID, messageId: "demo-user-1" },
    );
    await runtimeHost.waitForIdle(DEMO_PROJECT_ID, DEMO_SESSION_ID);
  }

  const replay = await store.replay();
  assertDemoReplay(replay);
  return store;
}

function assertDemoReplay(events: readonly LoomEventEnvelope[]): void {
  const first = events[0];
  const last = events.at(-1);
  const completedMessages = events
    .filter(
      (event) =>
        event.type === "message.assistant_completed" && event.payload.taskId === DEMO_TASK_ID,
    )
    .map((event) => event.payload.content);
  const userMessages = events.filter(
    (event) => event.type === "message.user_appended" && event.payload.messageId === "demo-user-1",
  );
  const taskStarts = events.filter(
    (event) => event.type === "task.started" && event.payload.taskId === DEMO_TASK_ID,
  );
  const taskTerminals = events.filter(
    (event) =>
      (event.type === "task.completed" ||
        event.type === "task.failed" ||
        event.type === "task.cancelled" ||
        event.type === "task.interrupted") &&
      event.payload.taskId === DEMO_TASK_ID,
  );
  const toolStarts = events.filter(
    (event) => event.type === "tool.started" && event.payload.taskId === DEMO_TASK_ID,
  );
  const toolEnds = events.filter(
    (event) =>
      (event.type === "tool.completed" || event.type === "tool.failed") &&
      event.payload.taskId === DEMO_TASK_ID,
  );
  const views = events.filter(
    (event) => event.type === "view.published" && event.payload.taskId === DEMO_TASK_ID,
  );
  const ready = events.find((event) => event.type === "session.ready");

  if (
    first?.type !== "session.created" ||
    first.payload.profile !== "raw-pi" ||
    last?.type !== "session.status_changed" ||
    last.payload.status !== "ready" ||
    userMessages.length !== 1 ||
    userMessages[0]?.payload.content !== DEMO_MESSAGE ||
    taskStarts.length !== 1 ||
    completedMessages.length !== 2 ||
    completedMessages[0] !== LOOM_FIXTURE_PREAMBLE ||
    completedMessages[1] !== LOOM_FIXTURE_FINAL ||
    toolStarts.length !== 1 ||
    toolStarts[0]?.payload.toolName !== LOOM_REFERENCE_BACKTEST_TOOL_NAME ||
    toolEnds.length !== 1 ||
    toolEnds[0]?.payload.toolCallId !== toolStarts[0]?.payload.toolCallId ||
    taskTerminals.length !== 1 ||
    taskTerminals[0]?.type !== "task.completed" ||
    views.length !== 1 ||
    !isLoomPublishedViewDescriptor(views[0]?.payload) ||
    views[0].payload.taskId !== DEMO_TASK_ID ||
    !isExpectedRuntime(ready?.payload.runtime) ||
    !assistantDeltasMatchCompletions(events) ||
    JSON.stringify(events).includes("deterministic thought")
  ) {
    throw new Error("The durable demo session does not match the deterministic Pi fixture");
  }
}

function assistantDeltasMatchCompletions(events: readonly LoomEventEnvelope[]): boolean {
  const deltas = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "message.assistant_delta") continue;
    const messageId = event.payload.messageId;
    const delta = event.payload.delta;
    if (typeof messageId !== "string" || typeof delta !== "string") return false;
    deltas.set(messageId, `${deltas.get(messageId) ?? ""}${delta}`);
  }
  return events
    .filter((event) => event.type === "message.assistant_completed")
    .every((event) => {
      const messageId = event.payload.messageId;
      return (
        typeof messageId === "string" &&
        typeof event.payload.content === "string" &&
        deltas.get(messageId) === event.payload.content
      );
    });
}

function isExpectedRuntime(input: unknown): boolean {
  return (
    input !== null &&
    typeof input === "object" &&
    "provider" in input &&
    input.provider === LOOM_FIXTURE_PROVIDER &&
    "model" in input &&
    input.model === LOOM_FIXTURE_MODEL &&
    "mode" in input &&
    input.mode === "offline-fixture"
  );
}
