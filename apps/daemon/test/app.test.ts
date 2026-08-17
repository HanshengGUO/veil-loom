import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LoomCapabilitiesResponseSchema,
  LoomErrorResponseSchema,
  LoomEventsResponseSchema,
  LoomHealthResponseSchema,
} from "@veilquant/loom-protocol";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { createLoomApp } from "../src/app.js";
import { SessionEventStoreRegistry } from "../src/event-store.js";

const TEST_ORIGIN = "http://127.0.0.1:3000";

describe("Loom daemon scaffold", () => {
  it("returns a versioned health response without local details", async () => {
    const response = await createLoomApp().request("/v0/health");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(Check(LoomHealthResponseSchema, body)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("/home/");
  });

  it("discovers Raw Pi and Veil profiles through the shared protocol", async () => {
    const app = createLoomApp();
    const response = await app.request("/v0/capabilities", {
      headers: await authorizedHeaders(app),
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(Check(LoomCapabilitiesResponseSchema, body)).toBe(true);
    expect(body).toMatchObject({
      profiles: [{ id: "raw-pi" }, { id: "veil" }],
    });
  });

  it("replays ordered events after a cursor", async () => {
    const fixture = await eventFixture();
    try {
      await fixture.store.append({ type: "session.created", payload: {} });
      await fixture.store.append({ type: "session.ready", payload: {} });

      const response = await fixture.app.request(
        "/v0/sessions/session-a/events?projectId=project-a&afterSequence=1",
        { headers: fixture.headers },
      );
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(Check(LoomEventsResponseSchema, body)).toBe(true);
      expect(body).toMatchObject({ events: [{ sequence: 2, type: "session.ready" }] });
    } finally {
      await fixture.cleanup();
    }
  });

  it("streams replay first and then live events without a gap", async () => {
    const fixture = await eventFixture();
    try {
      await fixture.store.append({ type: "session.created", payload: {} });
      await fixture.store.append({ type: "session.ready", payload: {} });

      const response = await fixture.app.request(
        "/v0/sessions/session-a/stream?projectId=project-a",
        { headers: { ...fixture.headers, "Last-Event-ID": "1" } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      if (reader === undefined) throw new Error("SSE response has no body");
      const decoder = new TextDecoder();

      const replay = decoder.decode((await reader.read()).value);
      expect(replay).toContain("id: 2\nevent: loom.event");

      await fixture.store.append({ type: "system.notice", payload: { message: "live" } });
      const live = decoder.decode((await reader.read()).value);
      expect(live).toContain("id: 3\nevent: loom.event");
      expect(live).toContain('"message":"live"');
      await reader.cancel();
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns stable redacted errors for invalid and ahead cursors", async () => {
    const fixture = await eventFixture();
    try {
      const invalid = await fixture.app.request(
        "/v0/sessions/session-a/events?projectId=../private&afterSequence=nope",
        { headers: fixture.headers },
      );
      const invalidBody: unknown = await invalid.json();
      expect(invalid.status).toBe(400);
      expect(Check(LoomErrorResponseSchema, invalidBody)).toBe(true);
      expect(invalidBody).toMatchObject({ code: "INVALID_REQUEST" });

      const ahead = await fixture.app.request(
        "/v0/sessions/session-a/events?projectId=project-a&afterSequence=1",
        { headers: fixture.headers },
      );
      const aheadBody: unknown = await ahead.json();
      expect(ahead.status).toBe(409);
      expect(aheadBody).toMatchObject({ code: "EVENT_CURSOR_AHEAD" });
      expect(ahead.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
      expect(JSON.stringify(aheadBody)).not.toContain(fixture.stateRoot);
    } finally {
      await fixture.cleanup();
    }
  });
});

async function eventFixture() {
  const stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-app-"));
  let eventNumber = 0;
  const eventStores = new SessionEventStoreRegistry({
    stateRoot,
    clock: () => "2026-08-17T10:00:00.000Z",
    eventId: () => `evt_${++eventNumber}`,
  });
  const app = createLoomApp({ eventStores });
  return {
    stateRoot,
    app,
    headers: await authorizedHeaders(app),
    store: await eventStores.get("project-a", "session-a"),
    cleanup: () => rm(stateRoot, { recursive: true, force: true }),
  };
}

async function authorizedHeaders(
  app: ReturnType<typeof createLoomApp>,
): Promise<Record<string, string>> {
  const response = await app.request("/v0/auth/bootstrap", {
    method: "POST",
    headers: { Origin: TEST_ORIGIN },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Bootstrap did not issue a session cookie");
  return { Origin: TEST_ORIGIN, Cookie: setCookie.split(";", 1)[0] ?? "" };
}
