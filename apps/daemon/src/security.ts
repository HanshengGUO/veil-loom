import { randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_WEB_ORIGIN = "http://127.0.0.1:3000";
export const SESSION_COOKIE_NAME = "loom_session";

const STARTUP_TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface DaemonSecurityOptions {
  allowedOrigin?: string;
  startupToken?: string;
}

export class DaemonSecurity {
  readonly allowedOrigin: string;
  readonly #startupToken: string;

  constructor(options: DaemonSecurityOptions = {}) {
    this.allowedOrigin = resolveAllowedWebOrigin(options.allowedOrigin);
    this.#startupToken = options.startupToken ?? createStartupToken();
    if (!TOKEN_PATTERN.test(this.#startupToken)) {
      throw new Error("The daemon startup token must be 32 bytes encoded as base64url");
    }
  }

  sessionCookie(): string {
    return `${SESSION_COOKIE_NAME}=${this.#startupToken}; HttpOnly; Path=/v0; SameSite=Strict`;
  }

  authorizes(cookieHeader: string | undefined): boolean {
    if (cookieHeader === undefined) return false;
    const values = cookieValues(cookieHeader, SESSION_COOKIE_NAME);
    if (values.length !== 1) return false;
    const candidate = values[0];
    if (candidate === undefined || !TOKEN_PATTERN.test(candidate)) return false;
    const expectedBytes = Buffer.from(this.#startupToken, "utf8");
    const candidateBytes = Buffer.from(candidate, "utf8");
    return (
      expectedBytes.length === candidateBytes.length &&
      timingSafeEqual(expectedBytes, candidateBytes)
    );
  }
}

export function createStartupToken(): string {
  return randomBytes(STARTUP_TOKEN_BYTES).toString("base64url");
}

export function resolveAllowedWebOrigin(input = DEFAULT_WEB_ORIGIN): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("LOOM_WEB_ORIGIN must be an HTTP loopback origin");
  }
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "LOOM_WEB_ORIGIN must be an HTTP loopback origin without credentials or a path",
    );
  }
  return url.origin;
}

function cookieValues(header: string, name: string): string[] {
  const values: string[] = [];
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const key = segment.slice(0, separator).trim();
    if (key !== name) continue;
    values.push(segment.slice(separator + 1).trim());
  }
  return values;
}
