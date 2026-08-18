import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createLoomApp } from "./app.js";
import { DEMO_PROJECT_ID, seedDemoSession } from "./demo-session.js";
import { SessionEventStoreRegistry } from "./event-store.js";
import { LoomProjectRegistry, resolveConfiguredProjectId } from "./project-readiness.js";
import { ResearchArtifactStore } from "./research-artifacts.js";
import { createDefaultRuntimeHost } from "./runtime-host.js";
import { DaemonSecurity, resolveAllowedWebOrigin } from "./security.js";
import { SelectionService } from "./selection-service.js";
import { daemonServeOptions, LOOPBACK_HOST, parseDaemonPort } from "./server-config.js";
import { resolveLoomStateRoot } from "./state-root.js";

const port = parseDaemonPort(process.env.LOOM_DAEMON_PORT);
const stateRoot = resolveLoomStateRoot();
const demoSessionEnabled = process.env.LOOM_DEMO_SESSION === "1";
const projectId = demoSessionEnabled
  ? DEMO_PROJECT_ID
  : resolveConfiguredProjectId(process.env.LOOM_PROJECT_ID);
const projectRoot = demoSessionEnabled
  ? resolve(import.meta.dirname, "../../../examples/daily-factor")
  : process.cwd();
const projects = new LoomProjectRegistry({ registrations: [{ projectId, root: projectRoot }] });
const eventStores = new SessionEventStoreRegistry({ stateRoot });
const artifacts = new ResearchArtifactStore({ stateRoot });
const selections = new SelectionService({ artifacts, eventStores });
const runtimeHost = createDefaultRuntimeHost({
  eventStores,
  artifacts,
  selections,
  cwd: projectRoot,
  agentDir: join(stateRoot, "pi"),
  projects,
});
const security = new DaemonSecurity({
  allowedOrigin: resolveAllowedWebOrigin(process.env.LOOM_WEB_ORIGIN),
});
await runtimeHost.reconcileDurableSessions();
if (demoSessionEnabled) await seedDemoSession(eventStores, runtimeHost);

serve(
  daemonServeOptions(
    createLoomApp({ eventStores, artifacts, runtimeHost, selections, security }).fetch,
    port,
  ),
);

process.stdout.write(
  `Veil Loom daemon listening on http://${LOOPBACK_HOST}:${port}${demoSessionEnabled ? " with the offline Pi fixture" : ""}\n`,
);
