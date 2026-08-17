import { serve } from "@hono/node-server";
import { createLoomApp } from "./app.js";
import { SessionEventStoreRegistry } from "./event-store.js";
import { resolveLoomStateRoot } from "./state-root.js";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 43_120;

export function parseDaemonPort(input: string | undefined): number {
  if (input === undefined) return DEFAULT_PORT;
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LOOM_DAEMON_PORT must be an integer between 1 and 65535");
  }
  return port;
}

const port = parseDaemonPort(process.env.LOOM_DAEMON_PORT);
const eventStores = new SessionEventStoreRegistry({ stateRoot: resolveLoomStateRoot() });

serve({
  fetch: createLoomApp({ eventStores }).fetch,
  hostname: LOOPBACK_HOST,
  port,
});

process.stdout.write(`Veil Loom daemon listening on http://${LOOPBACK_HOST}:${port}\n`);
