import { serve } from "@hono/node-server";
import { createLoomApp } from "./app.js";
import { seedDemoSession } from "./demo-session.js";
import { SessionEventStoreRegistry } from "./event-store.js";
import { DaemonSecurity, resolveAllowedWebOrigin } from "./security.js";
import { daemonServeOptions, LOOPBACK_HOST, parseDaemonPort } from "./server-config.js";
import { resolveLoomStateRoot } from "./state-root.js";

const port = parseDaemonPort(process.env.LOOM_DAEMON_PORT);
const eventStores = new SessionEventStoreRegistry({ stateRoot: resolveLoomStateRoot() });
const security = new DaemonSecurity({
  allowedOrigin: resolveAllowedWebOrigin(process.env.LOOM_WEB_ORIGIN),
});
const demoSessionEnabled = process.env.LOOM_DEMO_SESSION === "1";

if (demoSessionEnabled) await seedDemoSession(eventStores);

serve(daemonServeOptions(createLoomApp({ eventStores, security }).fetch, port));

process.stdout.write(
  `Veil Loom daemon listening on http://${LOOPBACK_HOST}:${port}${demoSessionEnabled ? " with the demo session" : ""}\n`,
);
