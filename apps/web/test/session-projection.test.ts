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
        format: "loom.view-published.v0",
        viewId: `view_${"a".repeat(64)}`,
        viewFormat: "loom.backtest-view.v0",
        kind: "backtest",
        title: "Daily factor",
        summary: "A validated exploratory view.",
        taskId: "task-1",
        assurance: {
          format: "loom.assurance.v0",
          state: "exploratory",
          issuer: "loom",
          evidenceRefs: [],
          limitations: ["Not independently verified"],
        },
      }),
      event(5, "selection.created", selectionPayload()),
      event(6, "message.assistant_delta", { messageId: "assistant-1", delta: "Done" }),
      event(7, "message.assistant_completed", { messageId: "assistant-1" }),
      event(8, "task.completed", { taskId: "task-1" }),
      event(9, "session.ready", {
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
      lastSequence: 9,
      profile: "raw-pi",
      status: "ready",
      runtime: { provider: "loom-offline-fixture", model: "loom-fixture-v0" },
      activeView: { viewId: `view_${"a".repeat(64)}`, title: "Daily factor" },
      activeSelection: { selectionId: "selection_one", viewId: `view_${"a".repeat(64)}` },
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

  it("fails closed instead of projecting an unvalidated view payload", () => {
    const state = createSessionProjection("project-a", "session-a");
    const result = applySessionEvent(
      state,
      event(1, "view.published", {
        viewId: "view-forged",
        kind: "backtest",
        title: "Forged",
        assurance: { state: "accepted" },
      }),
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      state: { lastSequence: 0, activeView: undefined, issue: { kind: "protocol" } },
    });
  });

  it("fails closed instead of projecting a forged selection summary", () => {
    const viewState = applySessionEvent(
      createSessionProjection("project-a", "session-a"),
      event(1, "view.published", {
        format: "loom.view-published.v0",
        viewId: `view_${"a".repeat(64)}`,
        viewFormat: "loom.backtest-view.v0",
        kind: "backtest",
        title: "Daily factor",
        summary: "A validated exploratory view.",
        taskId: "task-1",
        assurance: {
          format: "loom.assurance.v0",
          state: "exploratory",
          issuer: "loom",
          evidenceRefs: [],
          limitations: ["Not independently verified"],
        },
      }),
    ).state;
    const forged = selectionPayload();
    const summary = forged.selection.visibleSummary[0];
    const result = applySessionEvent(
      viewState,
      event(2, "selection.created", {
        ...forged,
        selection: {
          ...forged.selection,
          visibleSummary: [{ ...summary, sampleScope: "full-sample", value: 99 }],
        },
      }),
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      state: { lastSequence: 1, activeSelection: undefined, issue: { kind: "protocol" } },
    });
  });

  it("restores an interrupted task as terminal after daemon recovery", () => {
    let state = createSessionProjection("project-a", "session-a");
    for (const fixtureEvent of [
      event(1, "session.created", { profile: "raw-pi" }),
      event(2, "task.started", { taskId: "task-1", label: "Interrupted research" }),
      event(3, "session.status_changed", { status: "recovering" }),
      event(4, "task.interrupted", { taskId: "task-1", code: "DAEMON_RESTART" }),
      event(5, "session.status_changed", { status: "ready", recovery: "resumed" }),
    ]) {
      const result = applySessionEvent(state, fixtureEvent);
      expect(result.outcome).toBe("applied");
      state = result.state;
    }
    expect(state).toMatchObject({
      status: "ready",
      tasks: [{ id: "task-1", label: "Interrupted research", status: "interrupted" }],
    });
  });
});

function selectionPayload() {
  return {
    format: "loom.selection-created.v0",
    commandId: "command-selection",
    selection: {
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
    },
  };
}

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
