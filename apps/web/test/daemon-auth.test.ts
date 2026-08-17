import { describe, expect, it } from "vitest";
import {
  bootstrapDaemonSession,
  type FetchPort,
  resolveDaemonOrigin,
} from "../src/lib/daemon-auth";

describe("browser daemon authentication", () => {
  it("bootstraps with credentialed CORS without receiving token material", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetchPort: FetchPort = async (input, init) => {
      calls.push({ input, init });
      return Response.json({ format: "loom.auth.v0", status: "ready" });
    };

    await bootstrapDaemonSession("http://127.0.0.1:43120", fetchPort);

    expect(String(calls[0]?.input)).toBe("http://127.0.0.1:43120/v0/auth/bootstrap");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "include",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  it("fails closed on an HTTP error or malformed acknowledgement", async () => {
    await expect(
      bootstrapDaemonSession("http://127.0.0.1:43120", async () =>
        Response.json({ code: "AUTH_REQUIRED" }, { status: 401 }),
      ),
    ).rejects.toThrow("rejected the authentication handshake");
    await expect(
      bootstrapDaemonSession("http://127.0.0.1:43120", async () =>
        Response.json({ format: "loom.auth.v0", status: "ready", token: "leak" }),
      ),
    ).rejects.toThrow("unsupported authentication data");
  });

  it("rejects non-loopback, credentialed, and path-bearing daemon origins", () => {
    expect(resolveDaemonOrigin("http://127.0.0.1:43120/")).toBe("http://127.0.0.1:43120");
    for (const input of [
      "https://127.0.0.1:43120",
      "http://localhost:43120",
      "http://user@127.0.0.1:43120",
      "http://127.0.0.1:43120/path",
      "https://example.com",
    ]) {
      expect(() => resolveDaemonOrigin(input)).toThrow("HTTP loopback origin");
    }
  });
});
