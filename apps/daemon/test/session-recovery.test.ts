import type { LoomEventEnvelope, LoomEventType } from "@veilquant/loom-protocol";
import { describe, expect, it } from "vitest";
import { projectSessionRecovery } from "../src/session-recovery.js";

describe("durable session recovery projection", () => {
  it("restores an open terminal session from its public transcript", () => {
    const plan = projectSessionRecovery("project-a", "session-a", [
      event(1, "session.created", { profile: "raw-pi", title: "Recovered research" }),
      event(2, "session.ready", { profile: "raw-pi", runtime: runtime() }),
      event(3, "message.user_appended", { messageId: "user-1", content: "Run it." }),
      event(4, "task.started", { taskId: "task-1" }),
      event(5, "message.assistant_delta", { messageId: "assistant-1", delta: "hidden duplicate" }),
      event(6, "message.assistant_completed", {
        messageId: "assistant-1",
        content: "The view is ready.",
      }),
      event(7, "task.completed", { taskId: "task-1" }),
      event(8, "session.status_changed", { status: "ready" }),
    ]);

    expect(plan).toMatchObject({
      disposition: "recover",
      profile: "raw-pi",
      title: "Recovered research",
      knownTaskIds: ["task-1"],
      interruptedTaskIds: [],
      runtime: { fingerprint: runtime().fingerprint },
    });
    expect(plan.publicContext).toContain("User: Run it.");
    expect(plan.publicContext).toContain("Assistant: The view is ready.");
    expect(plan.publicContext).not.toContain("hidden duplicate");
  });

  it("marks running and cancel-requested tasks interrupted without guessing a terminal", () => {
    const plan = projectSessionRecovery("project-a", "session-a", [
      event(1, "session.created", { profile: "raw-pi" }),
      event(2, "session.ready", { runtime: runtime() }),
      event(3, "task.started", { taskId: "task-running" }),
      event(4, "task.started", { taskId: "task-cancelling" }),
      event(5, "task.cancel_requested", { taskId: "task-cancelling" }),
      event(6, "session.status_changed", { status: "busy" }),
    ]);
    expect(plan).toMatchObject({
      disposition: "recover",
      knownTaskIds: ["task-running", "task-cancelling"],
      interruptedTaskIds: ["task-running", "task-cancelling"],
    });
  });

  it("does not reopen closed, failed, or never-ready sessions", () => {
    const base = [
      event(1, "session.created", { profile: "raw-pi" }),
      event(2, "session.ready", { runtime: runtime() }),
    ];
    expect(
      projectSessionRecovery("project-a", "session-a", [
        ...base,
        event(3, "session.status_changed", { status: "closed" }),
      ]).disposition,
    ).toBe("closed");
    expect(
      projectSessionRecovery("project-a", "session-a", [
        ...base,
        event(3, "session.status_changed", { status: "failed" }),
      ]).disposition,
    ).toBe("failed");
    expect(
      projectSessionRecovery("project-a", "session-a", [
        event(1, "session.created", { profile: "raw-pi" }),
        event(2, "session.status_changed", { status: "starting" }),
      ]).disposition,
    ).toBe("incomplete");
  });

  it("rejects duplicate starts, orphan terminals, and foreign ownership", () => {
    expect(() =>
      projectSessionRecovery("project-a", "session-a", [
        event(1, "session.created", { profile: "raw-pi" }),
        event(2, "task.completed", { taskId: "task-1" }),
      ]),
    ).toThrow(/invalid terminal record/);
    expect(() =>
      projectSessionRecovery("project-a", "session-a", [
        event(1, "session.created", { profile: "raw-pi" }),
        event(2, "task.started", { taskId: "task-1" }),
        event(3, "task.started", { taskId: "task-1" }),
      ]),
    ).toThrow(/started more than once/);
    expect(() =>
      projectSessionRecovery("project-a", "session-a", [
        { ...event(1, "session.created", { profile: "raw-pi" }), projectId: "project-b" },
      ]),
    ).toThrow(/ownership/);
  });

  it("bounds legacy reconstruction context to recent public completions", () => {
    const messages = Array.from({ length: 40 }, (_, index) =>
      event(index + 3, "message.user_appended", {
        messageId: `message-${index}`,
        content: `marker-${index}-${"x".repeat(1_500)}`,
      }),
    );
    const plan = projectSessionRecovery("project-a", "session-a", [
      event(1, "session.created", { profile: "raw-pi" }),
      event(2, "session.ready", { profile: "raw-pi", runtime: runtime() }),
      ...messages,
    ]);

    expect(plan.publicContext?.length).toBeLessThanOrEqual(32_768);
    expect(plan.publicContext).toContain("marker-39");
    expect(plan.publicContext).not.toContain("marker-0-");
  });

  it("rejects a changed runtime identity and an active task in a closed session", () => {
    expect(() =>
      projectSessionRecovery("project-a", "session-a", [
        event(1, "session.created", { profile: "raw-pi" }),
        event(2, "session.ready", { runtime: runtime() }),
        event(3, "session.ready", {
          runtime: { ...runtime(), model: "another-model", fingerprint: "another-fingerprint" },
        }),
      ]),
    ).toThrow(/changed runtime identity/);
    expect(() =>
      projectSessionRecovery("project-a", "session-a", [
        event(1, "session.created", { profile: "raw-pi" }),
        event(2, "session.ready", { runtime: runtime() }),
        event(3, "task.started", { taskId: "task-1" }),
        event(4, "session.status_changed", { status: "closed" }),
      ]),
    ).toThrow(/still owns an active task/);
  });
});

function runtime() {
  return {
    format: "loom.pi-runtime.v0" as const,
    package: "@earendil-works/pi-coding-agent" as const,
    version: "0.84.2",
    provider: "loom-offline-fixture",
    model: "loom-fixture-v0",
    mode: "offline-fixture" as const,
    fingerprint: "pi-0.84.2__loom-offline-fixture__loom-fixture-v0",
  };
}

function event(
  sequence: number,
  type: LoomEventType,
  payload: Record<string, unknown>,
): LoomEventEnvelope {
  return {
    format: "loom.event.v0",
    eventId: `event-${sequence}`,
    projectId: "project-a",
    sessionId: "session-a",
    sequence,
    occurredAt: "2026-08-18T00:00:00.000Z",
    type,
    payload,
  };
}
