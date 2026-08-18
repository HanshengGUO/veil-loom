import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionEventStoreRegistry } from "../src/event-store.js";
import type { RuntimeAdapterError } from "../src/runtime-adapter.js";
import { createDefaultRuntimeHost, type LoomRuntimeHost } from "../src/runtime-host.js";

describe("daemon restart reconciliation", () => {
  let stateRoot: string;
  const liveHosts: Array<{ host: LoomRuntimeHost; projectId: string; sessionId: string }> = [];

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-runtime-recovery-"));
  });

  afterEach(async () => {
    for (const entry of liveHosts) {
      await entry.host.closeSession(entry.projectId, entry.sessionId);
    }
    liveHosts.length = 0;
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("reopens the durable Pi conversation and accepts a new task", async () => {
    const firstRegistry = registry();
    const firstHost = host(firstRegistry);
    await firstHost.createSession(
      { projectId: "project-a", profile: "raw-pi", title: "Restartable research" },
      { sessionId: "session-a", commandId: "create-a" },
    );
    await firstHost.sendMessage(
      { projectId: "project-a", sessionId: "session-a", content: "Run the first pass." },
      { commandId: "command-1", taskId: "task-1", messageId: "message-1" },
    );
    await firstHost.waitForIdle("project-a", "session-a");

    const restartedRegistry = registry();
    const restartedHost = host(restartedRegistry);
    liveHosts.push({ host: restartedHost, projectId: "project-a", sessionId: "session-a" });
    await expect(restartedHost.reconcileDurableSessions()).resolves.toEqual({
      discovered: 1,
      recovered: 1,
      skipped: 0,
      failed: 0,
      interruptedTasks: 0,
    });
    await expect(
      restartedHost.cancelTask(
        { projectId: "project-a", sessionId: "session-a", taskId: "task-1" },
        "cancel-old",
      ),
    ).rejects.toMatchObject({
      code: "TASK_NOT_CANCELLABLE",
    } satisfies Partial<RuntimeAdapterError>);

    await restartedHost.sendMessage(
      { projectId: "project-a", sessionId: "session-a", content: "Run the second pass." },
      { commandId: "command-2", taskId: "task-2", messageId: "message-2" },
    );
    await restartedHost.waitForIdle("project-a", "session-a");
    const events = await (await restartedRegistry.get("project-a", "session-a")).replay();

    expect(events.filter((event) => event.type === "session.created")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.status_changed",
        payload: { status: "ready", recovery: "resumed" },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task.completed", payload: { taskId: "task-2" } }),
    );
  });

  it("terminalizes a cancel-requested task once and keeps the recovered session usable", async () => {
    const firstRegistry = registry();
    const firstHost = host(firstRegistry);
    await firstHost.createSession(
      { projectId: "project-a", profile: "raw-pi" },
      { sessionId: "session-interrupted", commandId: "create-interrupted" },
    );
    const store = await firstRegistry.get("project-a", "session-interrupted");
    await store.append({
      type: "message.user_appended",
      payload: { messageId: "message-old", commandId: "command-old", content: "Old task" },
    });
    await store.append({ type: "session.status_changed", payload: { status: "busy" } });
    await store.append({
      type: "task.started",
      payload: { taskId: "task-old", commandId: "command-old", kind: "pi-prompt" },
    });
    await store.append({
      type: "task.cancel_requested",
      payload: { taskId: "task-old", commandId: "cancel-old" },
    });

    const restartedRegistry = registry();
    const restartedHost = host(restartedRegistry);
    liveHosts.push({
      host: restartedHost,
      projectId: "project-a",
      sessionId: "session-interrupted",
    });
    await expect(restartedHost.reconcileDurableSessions()).resolves.toMatchObject({
      recovered: 1,
      failed: 0,
      interruptedTasks: 1,
    });
    const recoveredStore = await restartedRegistry.get("project-a", "session-interrupted");
    const afterFirstRecovery = await recoveredStore.replay();
    expect(afterFirstRecovery).toContainEqual(
      expect.objectContaining({
        type: "task.interrupted",
        payload: expect.objectContaining({ taskId: "task-old", code: "DAEMON_RESTART" }),
      }),
    );
    expect(afterFirstRecovery.at(-1)).toMatchObject({
      type: "session.status_changed",
      payload: { status: "ready", recovery: "reconstructed" },
    });

    await expect(restartedHost.reconcileDurableSessions()).resolves.toMatchObject({
      recovered: 0,
      skipped: 1,
      interruptedTasks: 0,
    });
    expect(await recoveredStore.replay()).toHaveLength(afterFirstRecovery.length);
    await expect(
      restartedHost.cancelTask(
        { projectId: "project-a", sessionId: "session-interrupted", taskId: "task-old" },
        "cancel-again",
      ),
    ).rejects.toMatchObject({ code: "TASK_NOT_CANCELLABLE" });

    await restartedHost.sendMessage(
      {
        projectId: "project-a",
        sessionId: "session-interrupted",
        content: "Start a clean task.",
      },
      { commandId: "command-new", taskId: "task-new", messageId: "message-new" },
    );
    await restartedHost.waitForIdle("project-a", "session-interrupted");
    expect(await recoveredStore.replay()).toContainEqual(
      expect.objectContaining({ type: "task.completed", payload: { taskId: "task-new" } }),
    );
  });

  it("reconstructs a legacy session from public completions when no Pi file exists", async () => {
    const durableRegistry = registry();
    const store = await durableRegistry.get("project-a", "legacy-session");
    await store.append({
      type: "session.created",
      payload: { profile: "raw-pi", title: "Legacy research", commandId: "create-legacy" },
    });
    await store.append({ type: "session.status_changed", payload: { status: "starting" } });
    await store.append({
      type: "session.ready",
      payload: { profile: "raw-pi", runtime: runtime() },
    });
    await store.append({
      type: "message.user_appended",
      payload: { messageId: "legacy-user", content: "Prior public request" },
    });
    await store.append({ type: "session.status_changed", payload: { status: "busy" } });
    await store.append({ type: "task.started", payload: { taskId: "legacy-task" } });
    await store.append({
      type: "message.assistant_delta",
      payload: { messageId: "legacy-assistant", taskId: "legacy-task", delta: "Prior answer" },
    });
    await store.append({
      type: "message.assistant_completed",
      payload: {
        messageId: "legacy-assistant",
        taskId: "legacy-task",
        content: "Prior answer",
      },
    });
    await store.append({ type: "task.completed", payload: { taskId: "legacy-task" } });
    await store.append({ type: "session.status_changed", payload: { status: "ready" } });

    const restartedRegistry = registry();
    const restartedHost = host(restartedRegistry);
    liveHosts.push({ host: restartedHost, projectId: "project-a", sessionId: "legacy-session" });
    await expect(restartedHost.reconcileDurableSessions()).resolves.toMatchObject({
      recovered: 1,
      failed: 0,
    });
    const recoveredStore = await restartedRegistry.get("project-a", "legacy-session");
    expect(await recoveredStore.replay()).toContainEqual(
      expect.objectContaining({
        type: "session.status_changed",
        payload: { status: "ready", recovery: "reconstructed" },
      }),
    );

    await restartedHost.sendMessage(
      { projectId: "project-a", sessionId: "legacy-session", content: "Continue safely." },
      { commandId: "legacy-next", taskId: "legacy-next-task", messageId: "legacy-next-user" },
    );
    await restartedHost.waitForIdle("project-a", "legacy-session");
    const events = await recoveredStore.replay();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "task.completed",
        payload: { taskId: "legacy-next-task" },
      }),
    );
    expect(JSON.stringify(events)).not.toContain("loom.pi-recovery-context.v0");
  }, 30_000);

  it("isolates incomplete and semantically corrupt sessions instead of making them executable", async () => {
    const durableRegistry = registry();
    const incomplete = await durableRegistry.get("project-a", "incomplete-session");
    await incomplete.append({
      type: "session.created",
      payload: { profile: "raw-pi", commandId: "create-incomplete" },
    });
    await incomplete.append({
      type: "session.status_changed",
      payload: { status: "starting" },
    });
    await incomplete.append({ type: "task.started", payload: { taskId: "orphaned-task" } });

    const corrupt = await durableRegistry.get("project-a", "corrupt-session");
    await corrupt.append({ type: "system.notice", payload: { message: "no creation record" } });

    const restartedRegistry = registry();
    const restartedHost = host(restartedRegistry);
    await expect(restartedHost.reconcileDurableSessions()).resolves.toEqual({
      discovered: 2,
      recovered: 0,
      skipped: 0,
      failed: 2,
      interruptedTasks: 1,
    });
    const incompleteEvents = await (
      await restartedRegistry.get("project-a", "incomplete-session")
    ).replay();
    expect(incompleteEvents.slice(-3)).toMatchObject([
      { type: "session.status_changed", payload: { status: "recovering" } },
      { type: "task.interrupted", payload: { taskId: "orphaned-task" } },
      {
        type: "session.status_changed",
        payload: { status: "failed", code: "SESSION_START_INTERRUPTED" },
      },
    ]);
    expect(
      await (await restartedRegistry.get("project-a", "corrupt-session")).replay(),
    ).toHaveLength(1);
    for (const sessionId of ["incomplete-session", "corrupt-session"]) {
      await expect(
        restartedHost.sendMessage({ projectId: "project-a", sessionId, content: "Do not run." }),
      ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    }
  });

  function registry(): SessionEventStoreRegistry {
    return new SessionEventStoreRegistry({ stateRoot });
  }

  function host(eventStores: SessionEventStoreRegistry): LoomRuntimeHost {
    return createDefaultRuntimeHost({
      eventStores,
      cwd: stateRoot,
      agentDir: join(stateRoot, "pi"),
    });
  }
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
