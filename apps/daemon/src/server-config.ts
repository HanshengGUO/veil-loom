export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_DAEMON_PORT = 43_120;

export function parseDaemonPort(input: string | undefined): number {
  if (input === undefined) return DEFAULT_DAEMON_PORT;
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LOOM_DAEMON_PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function daemonServeOptions(
  fetch: (request: Request) => Response | Promise<Response>,
  port: number,
): {
  fetch: (request: Request) => Response | Promise<Response>;
  hostname: typeof LOOPBACK_HOST;
  port: number;
} {
  return { fetch, hostname: LOOPBACK_HOST, port };
}
