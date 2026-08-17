import {
  LOOM_PROFILE_DESCRIPTORS,
  type LoomCapabilitiesResponse,
  type LoomHealthResponse,
} from "@veilquant/loom-protocol";
import { Hono } from "hono";

const DAEMON_VERSION = "0.0.0";

export function createLoomApp(): Hono {
  const app = new Hono();

  app.get("/v0/health", (context) => {
    const response = {
      format: "loom.health.v0",
      service: "veil-loom-daemon",
      status: "ok",
      version: DAEMON_VERSION,
    } satisfies LoomHealthResponse;
    return context.json(response);
  });

  app.get("/v0/capabilities", (context) => {
    const response = {
      format: "loom.capabilities.v0",
      profiles: LOOM_PROFILE_DESCRIPTORS,
    } satisfies LoomCapabilitiesResponse;
    return context.json(response);
  });

  return app;
}
