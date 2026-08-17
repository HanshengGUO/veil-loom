import type { LoomEventEnvelope, LoomEventType } from "@veilquant/loom-protocol";
import { describe, expect, it } from "vitest";
import { applySessionEvent, createSessionProjection } from "../src/lib/session-projection";

describe("session projection reducer", () => {
  it("projects an ordered session without trusting UI-only state", () => {
    let state = createSessionProjection("project-a", "session-a");
    for (const fixtureEvent of [
      event(1, "session.created", { profile: "raw-pi" }),
      event(2, "message.user_appended", { messageId: "user-1", content: "Run it" }),
      event(3, "task.started", { taskId: "task-1", label: "Reference backtest" }),
      event(4, "view.published", {
        viewId: "view-1",
        kind: "backtest",
        title: "Daily factor",
      }),
      event(5, "message.assistant_delta", { messageId: "assistant-1", delta: "Done" }),
      event(6, "message.assistant_completed", { messageId: "assistant-1" }),
      event(7, "task.completed", { taskId: "task-1" }),
      event(8, "session.ready", {
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
    ]) {
      const result = applySessionEvent(state, fixtureEvent);
      expect(result.outcome).toBe("applied");
      state = result.state;
    }

    expect(state).toMatchObject({
      lastSequence: 8,
      profile: "raw-pi",
      status: "ready",
      runtime: { provider: "loom-offline-fixture", model: "loom-fixture-v0" },
      activeView: { id: "view-1", title: "Daily factor" },
      conversation: [
        { id: "user-1", role: "user", content: "Run it" },
        { id: "assistant-1", role: "assistant", content: "Done", complete: true },
      ],
      tasks: [{ id: "task-1", label: "Reference backtest", status: "completed" }],
    });
  });

  it("ignores an exact duplicate and rejects sequence reuse", () => {
    const first = event(1, "session.created", { profile: "raw-pi" });
    const applied = applySessionEvent(createSessionProjection("project-a", "session-a"), first);

    expect(applySessionEvent(applied.state, first)).toMatchObject({ outcome: "duplicate" });
    const conflict = applySessionEvent(applied.state, { ...first, eventId: "evt-conflict" });
    expect(conflict).toMatchObject({
      outcome: "rejected",
      state: { lastSequence: 1, issue: { kind: "conflict" } },
    });

    const altered = applySessionEvent(applied.state, {
      ...first,
      payload: { profile: "veil" },
    });
    expect(altered).toMatchObject({ outcome: "rejected", state: { issue: { kind: "conflict" } } });

    const reusedId = applySessionEvent(applied.state, {
      ...event(2, "session.ready", {}),
      eventId: first.eventId,
    });
    expect(reusedId).toMatchObject({
      outcome: "rejected",
      state: { issue: { kind: "conflict" } },
    });
  });

  it("stops on a gap and resumes only when the missing sequence arrives", () => {
    const first = applySessionEvent(
      createSessionProjection("project-a", "session-a"),
      event(1, "session.created", {}),
    ).state;
    const gap = applySessionEvent(first, event(3, "session.ready", {}));
    expect(gap).toMatchObject({
      outcome: "gap",
      state: {
        lastSequence: 1,
        issue: { kind: "gap", expectedSequence: 2, receivedSequence: 3 },
      },
    });

    const recovered = applySessionEvent(
      gap.state,
      event(2, "message.user_appended", { content: "Recovered" }),
    );
    expect(recovered).toMatchObject({ outcome: "applied", state: { lastSequence: 2 } });
    expect(recovered.state.issue).toBeUndefined();
  });

  it("rejects events owned by another project or session", () => {
    const state = createSessionProjection("project-a", "session-a");
    const result = applySessionEvent(state, {
      ...event(1, "session.created", {}),
      projectId: "project-b",
    });
    expect(result).toMatchObject({
      outcome: "rejected",
      state: { lastSequence: 0, issue: { kind: "ownership" } },
    });
  });
});

function event(
  sequence: number,
  type: LoomEventType,
  payload: Record<string, unknown>,
): LoomEventEnvelope {
  return {
    format: "loom.event.v0",
    eventId: `evt-${sequence}`,
    projectId: "project-a",
    sessionId: "session-a",
    sequence,
    occurredAt: "2026-08-17T10:00:00.000Z",
    type,
    payload,
  };
}
