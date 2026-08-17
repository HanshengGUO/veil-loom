import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isLoomPublishedViewDescriptor } from "@veilquant/loom-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionEventStoreRegistry } from "../src/event-store.js";
import { LoomProjectRegistry } from "../src/project-readiness.js";
import { createDefaultRuntimeHost, type LoomRuntimeHost } from "../src/runtime-host.js";

const EXAMPLE_ROOT = resolve(import.meta.dirname, "../../../examples/daily-factor");

describe("Veil Pi runtime profile", () => {
  let stateRoot: string;
  const liveHosts: LoomRuntimeHost[] = [];

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-veil-runtime-"));
  });

  afterEach(async () => {
    for (const host of liveHosts) await host.closeSession("daily-factor-demo", "veil-session");
    liveHosts.length = 0;
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("loads Veil capability while preserving exploratory assurance across restart", async () => {
    const firstStores = stores();
    const firstHost = host(firstStores);
    await firstHost.createSession(
      { projectId: "daily-factor-demo", profile: "veil", title: "Veil exploration" },
      { sessionId: "veil-session", commandId: "create-veil" },
    );
    await firstHost.sendMessage(
      {
        projectId: "daily-factor-demo",
        sessionId: "veil-session",
        content: "Inspect the committed fixture without making a verified claim.",
      },
      { commandId: "command-1", taskId: "task-1", messageId: "message-1" },
    );
    await firstHost.waitForIdle("daily-factor-demo", "veil-session");

    const restartedStores = stores();
    const restartedHost = host(restartedStores);
    liveHosts.push(restartedHost);
    await expect(restartedHost.reconcileDurableSessions()).resolves.toEqual({
      discovered: 1,
      recovered: 1,
      skipped: 0,
      failed: 0,
      interruptedTasks: 0,
    });
    await restartedHost.sendMessage(
      {
        projectId: "daily-factor-demo",
        sessionId: "veil-session",
        content: "Continue the exploration.",
      },
      { commandId: "command-2", taskId: "task-2", messageId: "message-2" },
    );
    await restartedHost.waitForIdle("daily-factor-demo", "veil-session");

    const events = await (await restartedStores.get("daily-factor-demo", "veil-session")).replay();
    expect(events.filter((event) => event.type === "session.created")).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session.created",
      payload: {
        profile: "veil",
        assurance: {
          format: "loom.assurance.v0",
          state: "exploratory",
          issuer: "loom",
          evidenceRefs: [],
          limitations: [
            "Veil capability is loaded, but no result is verified until Veil issues independent evidence.",
          ],
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.ready",
        payload: expect.objectContaining({
          profile: "veil",
          runtime: expect.objectContaining({
            fingerprint: "pi-0.84.2__loom-offline-fixture__loom-fixture-v0__veil-0.1.0",
          }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.status_changed",
        payload: { status: "ready", recovery: "resumed" },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task.completed", payload: { taskId: "task-2" } }),
    );
    const published = events.filter(
      (event) => event.type === "view.published" && isLoomPublishedViewDescriptor(event.payload),
    );
    expect(published).toHaveLength(2);
    expect(published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            assurance: expect.objectContaining({
              state: "exploratory",
              issuer: "loom",
              evidenceRefs: [],
            }),
          }),
        }),
      ]),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('"state":"accepted"');
    expect(serialized).not.toContain('"state":"degraded"');
    expect(serialized).not.toContain('"state":"rejected"');
    expect(serialized).not.toContain("veil.promotion-candidate.v0");
    expect(serialized).not.toContain("veil.experiment.v0");
  });

  it("does not create a durable session when the Veil project is not ready", async () => {
    const eventStores = stores();
    const projects = new LoomProjectRegistry({
      registrations: [{ projectId: "daily-factor-demo", root: stateRoot }],
    });
    const runtime = createDefaultRuntimeHost({
      eventStores,
      cwd: stateRoot,
      agentDir: join(stateRoot, "pi"),
      projects,
    });

    await expect(
      runtime.createSession(
        { projectId: "daily-factor-demo", profile: "veil" },
        { sessionId: "veil-session", commandId: "create-veil" },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_READY" });
    await expect(eventStores.discover()).resolves.toEqual([]);
  });

  function stores(): SessionEventStoreRegistry {
    return new SessionEventStoreRegistry({ stateRoot });
  }

  function host(eventStores: SessionEventStoreRegistry): LoomRuntimeHost {
    const projects = new LoomProjectRegistry({
      registrations: [{ projectId: "daily-factor-demo", root: EXAMPLE_ROOT }],
    });
    return createDefaultRuntimeHost({
      eventStores,
      cwd: EXAMPLE_ROOT,
      agentDir: join(stateRoot, "pi"),
      projects,
    });
  }
});
