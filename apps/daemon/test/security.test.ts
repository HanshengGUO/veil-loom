import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { LoomAuthResponseSchema, LoomErrorResponseSchema } from "@veilquant/loom-protocol";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { createLoomApp } from "../src/app.js";
import {
  createStartupToken,
  DaemonSecurity,
  resolveAllowedWebOrigin,
  SESSION_COOKIE_NAME,
} from "../src/security.js";
import { daemonServeOptions, LOOPBACK_HOST } from "../src/server-config.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:3000";
const FIRST_TOKEN = "A".repeat(43);
const SECOND_TOKEN = "B".repeat(43);

describe("daemon request security", () => {
  it("bootstraps an HttpOnly session without putting token material in JSON", async () => {
    const app = securedApp(FIRST_TOKEN);
    const response = await bootstrap(app);
    const body: unknown = await response.json();
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(Check(LoomAuthResponseSchema, body)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(FIRST_TOKEN);
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=${FIRST_TOKEN}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/v0");
    expect(setCookie).toContain("SameSite=Strict");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("rejects bootstrap from a missing, null, or untrusted Origin", async () => {
    const app = securedApp(FIRST_TOKEN);
    for (const headers of [{}, { Origin: "null" }, { Origin: "https://attacker.example" }]) {
      const response = await app.request("/v0/auth/bootstrap", { method: "POST", headers });
      const body: unknown = await response.json();
      expect(response.status).toBe(403);
      expect(Check(LoomErrorResponseSchema, body)).toBe(true);
      expect(body).toMatchObject({ code: "ORIGIN_FORBIDDEN" });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("requires both the exact Origin and a valid cookie on protected routes", async () => {
    const app = securedApp(FIRST_TOKEN);
    const missing = await app.request("/v0/capabilities", {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(missing.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);

    const forged = await app.request("/v0/capabilities", {
      headers: { Origin: ALLOWED_ORIGIN, Cookie: `${SESSION_COOKIE_NAME}=${SECOND_TOKEN}` },
    });
    expect(forged.status).toBe(401);

    const cookie = cookieFrom(await bootstrap(app));
    const allowed = await app.request("/v0/capabilities", {
      headers: { Origin: ALLOWED_ORIGIN, Cookie: cookie },
    });
    expect(allowed.status).toBe(200);

    const wrongOrigin = await app.request("/v0/capabilities", {
      headers: { Origin: "http://127.0.0.1:4000", Cookie: cookie },
    });
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("invalidates browser sessions when the daemon startup token rotates", async () => {
    const first = securedApp(FIRST_TOKEN);
    const staleCookie = cookieFrom(await bootstrap(first));
    const restarted = securedApp(SECOND_TOKEN);

    const response = await restarted.request("/v0/capabilities", {
      headers: { Origin: ALLOWED_ORIGIN, Cookie: staleCookie },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("answers CORS preflight only for the configured Origin", async () => {
    const app = securedApp(FIRST_TOKEN);
    const allowed = await app.request("/v0/sessions/session-a/stream", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");

    const rejected = await app.request("/v0/sessions/session-a/stream", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects ambiguous duplicate auth cookies", () => {
    const security = new DaemonSecurity({
      allowedOrigin: ALLOWED_ORIGIN,
      startupToken: FIRST_TOKEN,
    });
    expect(
      security.authorizes(
        `${SESSION_COOKIE_NAME}=${FIRST_TOKEN}; ${SESSION_COOKIE_NAME}=${FIRST_TOKEN}`,
      ),
    ).toBe(false);
  });

  it("accepts only explicit HTTP loopback web origins", () => {
    expect(resolveAllowedWebOrigin("http://127.0.0.1:3000/")).toBe(ALLOWED_ORIGIN);
    expect(() => resolveAllowedWebOrigin("https://127.0.0.1:3000")).toThrow("HTTP loopback origin");
    expect(() => resolveAllowedWebOrigin("http://localhost:3000")).toThrow("HTTP loopback origin");
    expect(() => resolveAllowedWebOrigin("http://127.0.0.1:3000/path")).toThrow(
      "without credentials or a path",
    );
    expect(() => resolveAllowedWebOrigin("http://user@127.0.0.1:3000")).toThrow(
      "without credentials or a path",
    );
  });

  it("generates independent 256-bit base64url startup tokens", () => {
    const first = createStartupToken();
    const second = createStartupToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });
});

describe("daemon network binding", () => {
  it("listens on IPv4 loopback rather than every interface", async () => {
    const app = createLoomApp();
    const server = serve(daemonServeOptions(app.fetch, 0));
    try {
      if (!server.listening) await once(server, "listening");
      const address = server.address() as AddressInfo;
      expect(address.address).toBe(LOOPBACK_HOST);
      expect(address.port).toBeGreaterThan(0);

      const response = await fetch(`http://${LOOPBACK_HOST}:${address.port}/v0/health`);
      expect(response.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});

function securedApp(startupToken: string): ReturnType<typeof createLoomApp> {
  return createLoomApp({
    security: new DaemonSecurity({ allowedOrigin: ALLOWED_ORIGIN, startupToken }),
  });
}

async function bootstrap(app: ReturnType<typeof createLoomApp>): Promise<Response> {
  return await app.request("/v0/auth/bootstrap", {
    method: "POST",
    headers: { Origin: ALLOWED_ORIGIN },
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("Bootstrap did not issue a cookie");
  return setCookie.split(";", 1)[0] ?? "";
}
