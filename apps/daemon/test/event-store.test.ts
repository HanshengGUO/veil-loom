import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SessionEventStore, SessionEventStoreRegistry } from "../src/event-store.js";

describe("durable session event store", () => {
  let stateRoot: string;
  let eventNumber: number;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-events-"));
    eventNumber = 0;
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("fsyncs an event before subscribers can observe it", async () => {
    const store = await openStore();
    const logPath = eventLogPath(stateRoot);
    let observedLog: Promise<string> | undefined;
    const subscription = await store.subscribeAfter(0, () => {
      observedLog = readFile(logPath, "utf8");
    });

    const event = await store.append({
      type: "system.notice",
      payload: { message: "durable" },
    });

    expect(observedLog).toBeDefined();
    await expect(observedLog).resolves.toBe(`${JSON.stringify(event)}\n`);
    subscription.unsubscribe();
  });

  it("assigns one contiguous order to concurrent appends", async () => {
    const store = await openStore();
    const events = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        store.append({ type: "system.notice", payload: { index } }),
      ),
    );

    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    const lines = (await readFile(eventLogPath(stateRoot), "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(24);
    expect(lines.map((line) => JSON.parse(line).sequence)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
  });

  it("replays durable events after a fresh registry opens the session", async () => {
    const first = await registry().get("project-a", "session-a");
    await first.append({ type: "session.created", payload: { profile: "raw-pi" } });
    await first.append({ type: "session.ready", payload: {} });

    const reopened = await registry().get("project-a", "session-a");
    const replay = await reopened.replay();

    expect(replay.map((event) => event.type)).toEqual(["session.created", "session.ready"]);
    expect(replay.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("discovers only portable sessions with regular durable logs", async () => {
    await (await registry().get("project-b", "session-2")).append({
      type: "session.created",
      payload: { profile: "raw-pi" },
    });
    await (await registry().get("project-a", "session-1")).append({
      type: "session.created",
      payload: { profile: "raw-pi" },
    });
    await mkdir(join(stateRoot, "projects", "invalid project", "sessions", "ignored"), {
      recursive: true,
    });
    await mkdir(join(stateRoot, "projects", "project-a", "sessions", "empty-session"), {
      recursive: true,
    });

    await expect(registry().discover()).resolves.toEqual([
      { projectId: "project-a", sessionId: "session-1" },
      { projectId: "project-b", sessionId: "session-2" },
    ]);
  });

  it("rejects a partial trailing record instead of silently discarding it", async () => {
    await mkdir(join(stateRoot, "projects/project-a/sessions/session-a"), { recursive: true });
    await writeFile(eventLogPath(stateRoot), '{"format":"loom.event.v0"', "utf8");

    await expect(openStore()).rejects.toMatchObject({
      code: "EVENT_LOG_TRUNCATED",
    });
  });

  it("rejects a non-contiguous event sequence", async () => {
    await mkdir(join(stateRoot, "projects/project-a/sessions/session-a"), { recursive: true });
    await writeFile(eventLogPath(stateRoot), `${JSON.stringify(eventRecord(2))}\n`, "utf8");

    await expect(openStore()).rejects.toMatchObject({
      code: "EVENT_SEQUENCE_INVALID",
    });
  });

  it("rejects cursors ahead of the durable log", async () => {
    const store = await openStore();
    await store.append({ type: "session.created", payload: {} });

    await expect(store.replay(2)).rejects.toMatchObject({
      code: "EVENT_CURSOR_AHEAD",
    });
  });

  it("subscribes atomically after replay without losing a live event", async () => {
    const store = await openStore();
    await store.append({ type: "session.created", payload: {} });
    const live: number[] = [];

    const subscription = await store.subscribeAfter(0, (event) => live.push(event.sequence));
    await store.append({ type: "session.ready", payload: {} });

    expect(subscription.replay.map((event) => event.sequence)).toEqual([1]);
    expect(live).toEqual([2]);
    subscription.unsubscribe();
  });

  it("isolates durable snapshots from caller and listener mutation or failure", async () => {
    const store = await openStore();
    const payload = { nested: { value: 1 } };
    await store.subscribeAfter(0, () => {
      throw new Error("consumer failed");
    });

    const appended = await store.append({ type: "system.notice", payload });
    payload.nested.value = 2;

    expect(appended.payload).toEqual({ nested: { value: 1 } });
    expect(Object.isFrozen(appended.payload.nested)).toBe(true);
    await expect(store.replay()).resolves.toEqual([appended]);
  });

  function registry(): SessionEventStoreRegistry {
    return new SessionEventStoreRegistry({
      stateRoot,
      clock: () => "2026-08-17T10:00:00.000Z",
      eventId: () => `evt_${String(++eventNumber).padStart(4, "0")}`,
    });
  }

  function openStore(): Promise<SessionEventStore> {
    return registry().get("project-a", "session-a");
  }
});

function eventLogPath(stateRoot: string): string {
  return join(stateRoot, "projects", "project-a", "sessions", "session-a", "events.jsonl");
}

function eventRecord(sequence: number): object {
  return {
    format: "loom.event.v0",
    eventId: `evt_${sequence}`,
    projectId: "project-a",
    sessionId: "session-a",
    sequence,
    occurredAt: "2026-08-17T10:00:00.000Z",
    type: "system.notice",
    payload: {},
  };
}
