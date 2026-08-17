import { isLoomAuthResponse } from "@veilquant/loom-protocol";

export const DEFAULT_DAEMON_ORIGIN = "http://127.0.0.1:43120";

export type FetchPort = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class DaemonAuthenticationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DaemonAuthenticationError";
  }
}

export function resolveDaemonOrigin(input = DEFAULT_DAEMON_ORIGIN): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new DaemonAuthenticationError(
      "NEXT_PUBLIC_LOOM_DAEMON_ORIGIN must be an HTTP loopback origin",
      { cause: error },
    );
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
    throw new DaemonAuthenticationError(
      "NEXT_PUBLIC_LOOM_DAEMON_ORIGIN must be an HTTP loopback origin without credentials or a path",
    );
  }
  return url.origin;
}

export async function bootstrapDaemonSession(
  daemonOrigin: string,
  fetchPort: FetchPort = globalThis.fetch,
): Promise<void> {
  const origin = resolveDaemonOrigin(daemonOrigin);
  let response: Response;
  try {
    response = await fetchPort(`${origin}/v0/auth/bootstrap`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    throw new DaemonAuthenticationError("The daemon authentication handshake could not connect", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new DaemonAuthenticationError("The daemon rejected the authentication handshake");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new DaemonAuthenticationError("The daemon returned malformed authentication data", {
      cause: error,
    });
  }
  if (!isLoomAuthResponse(body)) {
    throw new DaemonAuthenticationError("The daemon returned unsupported authentication data");
  }
}
