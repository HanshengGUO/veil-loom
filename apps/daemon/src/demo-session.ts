import type {
  AppendEventInput,
  SessionEventStore,
  SessionEventStoreRegistry,
} from "./event-store.js";

export const DEMO_PROJECT_ID = "daily-factor-demo";
export const DEMO_SESSION_ID = "raw-pi-demo";

const DEMO_EVENTS = [
  {
    type: "session.created",
    payload: { profile: "raw-pi", title: "Daily factor walkthrough" },
  },
  { type: "session.ready", payload: { profile: "raw-pi" } },
  {
    type: "message.user_appended",
    payload: {
      messageId: "demo-user-1",
      content: "Open the daily factor example and show me where it struggled out of sample.",
    },
  },
  { type: "session.status_changed", payload: { status: "busy" } },
  {
    type: "task.started",
    payload: { taskId: "demo-task-1", label: "Run the reference backtest" },
  },
  {
    type: "tool.started",
    payload: {
      toolCallId: "demo-tool-1",
      toolName: "reference_backtest",
      label: "Reference backtest",
    },
  },
  {
    type: "tool.completed",
    payload: {
      toolCallId: "demo-tool-1",
      toolName: "reference_backtest",
      label: "Reference backtest complete",
    },
  },
  {
    type: "view.published",
    payload: {
      viewId: "daily-factor-view-1",
      kind: "backtest",
      title: "Daily factor · exploratory",
      summary: "Deterministic demo projection; no Veil evidence has been issued.",
    },
  },
  {
    type: "message.assistant_completed",
    payload: {
      messageId: "demo-assistant-1",
      content:
        "The demo backtest is on the canvas. It remains exploratory until a separate Veil verification attempt re-executes the locked artifact.",
    },
  },
  { type: "task.completed", payload: { taskId: "demo-task-1" } },
  { type: "session.status_changed", payload: { status: "ready" } },
] as const satisfies readonly AppendEventInput[];

export async function seedDemoSession(
  eventStores: SessionEventStoreRegistry,
): Promise<SessionEventStore> {
  const store = await eventStores.get(DEMO_PROJECT_ID, DEMO_SESSION_ID);
  const existing = await store.replay();
  if (existing.length > DEMO_EVENTS.length) {
    throw new Error("The demo session contains events outside the deterministic fixture");
  }

  for (const [index, event] of existing.entries()) {
    const expected = DEMO_EVENTS[index];
    if (
      expected === undefined ||
      event.type !== expected.type ||
      JSON.stringify(event.payload) !== JSON.stringify(expected.payload)
    ) {
      throw new Error("The durable demo session does not match the deterministic fixture");
    }
  }

  for (const event of DEMO_EVENTS.slice(existing.length)) {
    await store.append(event);
  }
  return store;
}
