import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_PROJECT_ID,
  DEMO_SESSION_ID,
  DEMO_TASK_ID,
  seedDemoSession,
} from "../src/demo-session.js";
import { SessionEventStoreRegistry } from "../src/event-store.js";
import { createDefaultRuntimeHost } from "../src/runtime-host.js";

describe("deterministic Pi demo session", () => {
  let stateRoot: string;
  let eventNumber: number;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-demo-"));
    eventNumber = 0;
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("runs one replayable walkthrough through the real Pi host", async () => {
    const eventStores = registry();
    const store = await seedDemoSession(eventStores, host(eventStores));
    const events = await store.replay();

    expect(events.length).toBeGreaterThan(11);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(events[0]).toMatchObject({ type: "session.created", payload: { profile: "raw-pi" } });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.ready",
        payload: expect.objectContaining({
          runtime: expect.objectContaining({ mode: "offline-fixture", version: "0.84.2" }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        payload: expect.objectContaining({ toolName: "loom_fixture_inspect" }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "task.completed", payload: { taskId: DEMO_TASK_ID } }),
    );
    expect(JSON.stringify(events)).not.toContain("deterministic thought");
    expect(events.some((event) => event.type === "view.published")).toBe(false);
  });

  it("validates and replays the fixture across daemon restarts", async () => {
    const firstRegistry = registry();
    await seedDemoSession(firstRegistry, host(firstRegistry));
    const reopenedRegistry = registry();
    const reopened = await seedDemoSession(reopenedRegistry, host(reopenedRegistry));

    const events = await reopened.replay();
    expect(events.at(-1)).toMatchObject({
      type: "session.status_changed",
      payload: { status: "ready" },
    });
  });

  it("fails rather than accepting a conflicting durable demo", async () => {
    const eventStores = registry();
    const store = await eventStores.get(DEMO_PROJECT_ID, DEMO_SESSION_ID);
    await store.append({ type: "system.notice", payload: { message: "different" } });

    await expect(seedDemoSession(eventStores, host(eventStores))).rejects.toThrow(
      "does not match the deterministic Pi fixture",
    );
  });

  function registry(): SessionEventStoreRegistry {
    return new SessionEventStoreRegistry({
      stateRoot,
      clock: () => "2026-08-17T10:00:00.000Z",
      eventId: () => `evt_demo_${++eventNumber}`,
    });
  }

  function host(eventStores: SessionEventStoreRegistry) {
    return createDefaultRuntimeHost({
      eventStores,
      cwd: stateRoot,
      agentDir: join(stateRoot, "pi"),
    });
  }
});
