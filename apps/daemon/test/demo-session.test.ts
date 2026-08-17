import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_PROJECT_ID, DEMO_SESSION_ID, seedDemoSession } from "../src/demo-session.js";
import { SessionEventStoreRegistry } from "../src/event-store.js";

describe("deterministic demo session", () => {
  let stateRoot: string;
  let eventNumber: number;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-demo-"));
    eventNumber = 0;
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("seeds one replayable Raw Pi walkthrough", async () => {
    const store = await seedDemoSession(registry());
    const events = await store.replay();

    expect(events).toHaveLength(11);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 1),
    );
    expect(events[0]).toMatchObject({ type: "session.created", payload: { profile: "raw-pi" } });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "view.published",
        payload: expect.objectContaining({ kind: "backtest" }),
      }),
    );
  });

  it("is idempotent across daemon restarts", async () => {
    await seedDemoSession(registry());
    const reopened = await seedDemoSession(registry());

    await expect(reopened.replay()).resolves.toHaveLength(11);
  });

  it("fails rather than overwriting a conflicting durable demo", async () => {
    const eventStores = registry();
    const store = await eventStores.get(DEMO_PROJECT_ID, DEMO_SESSION_ID);
    await store.append({ type: "system.notice", payload: { message: "different" } });

    await expect(seedDemoSession(eventStores)).rejects.toThrow(
      "does not match the deterministic fixture",
    );
  });

  function registry(): SessionEventStoreRegistry {
    return new SessionEventStoreRegistry({
      stateRoot,
      clock: () => "2026-08-17T10:00:00.000Z",
      eventId: () => `evt_demo_${++eventNumber}`,
    });
  }
});
