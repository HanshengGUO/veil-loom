import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createLoomApp } from "./app.js";
import { seedDemoSession } from "./demo-session.js";
import { SessionEventStoreRegistry } from "./event-store.js";
import { ResearchArtifactStore } from "./research-artifacts.js";
import { createDefaultRuntimeHost } from "./runtime-host.js";
import { DaemonSecurity, resolveAllowedWebOrigin } from "./security.js";
import { daemonServeOptions, LOOPBACK_HOST, parseDaemonPort } from "./server-config.js";
import { resolveLoomStateRoot } from "./state-root.js";

const port = parseDaemonPort(process.env.LOOM_DAEMON_PORT);
const stateRoot = resolveLoomStateRoot();
const eventStores = new SessionEventStoreRegistry({ stateRoot });
const artifacts = new ResearchArtifactStore({ stateRoot });
const runtimeHost = createDefaultRuntimeHost({
  eventStores,
  artifacts,
  cwd: process.cwd(),
  agentDir: join(stateRoot, "pi"),
});
const security = new DaemonSecurity({
  allowedOrigin: resolveAllowedWebOrigin(process.env.LOOM_WEB_ORIGIN),
});
const demoSessionEnabled = process.env.LOOM_DEMO_SESSION === "1";

if (demoSessionEnabled) await seedDemoSession(eventStores, runtimeHost);

serve(
  daemonServeOptions(createLoomApp({ eventStores, artifacts, runtimeHost, security }).fetch, port),
);

process.stdout.write(
  `Veil Loom daemon listening on http://${LOOPBACK_HOST}:${port}${demoSessionEnabled ? " with the offline Pi fixture" : ""}\n`,
);
