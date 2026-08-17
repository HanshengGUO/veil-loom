import { join } from "node:path";
import {
  isLoomCancelTaskRequest,
  isLoomCreateSessionRequest,
  isLoomPortableId,
  isLoomSendMessageRequest,
  LOOM_PROFILE_DESCRIPTORS,
  type LoomAuthResponse,
  type LoomCapabilitiesResponse,
  type LoomErrorCode,
  type LoomErrorResponse,
  type LoomEventEnvelope,
  type LoomEventsResponse,
  type LoomHealthResponse,
} from "@veilquant/loom-protocol";
import { Hono } from "hono";
import { SessionEventStoreError, SessionEventStoreRegistry } from "./event-store.js";
import {
  canonicalJson,
  ResearchArtifactError,
  ResearchArtifactStore,
} from "./research-artifacts.js";
import { RuntimeAdapterError } from "./runtime-adapter.js";
import { createDefaultRuntimeHost, type LoomRuntimeHost } from "./runtime-host.js";
import { DaemonSecurity } from "./security.js";
import { resolveLoomStateRoot } from "./state-root.js";

const DAEMON_VERSION = "0.0.0";

export interface LoomAppOptions {
  eventStores?: SessionEventStoreRegistry;
  artifacts?: ResearchArtifactStore;
  runtimeHost?: LoomRuntimeHost;
  security?: DaemonSecurity;
}

export function createLoomApp(options: LoomAppOptions = {}): Hono {
  const app = new Hono();
  const stateRoot = resolveLoomStateRoot();
  const eventStores = options.eventStores ?? new SessionEventStoreRegistry({ stateRoot });
  const artifacts =
    options.artifacts ?? new ResearchArtifactStore({ stateRoot: eventStores.stateRoot });
  const runtimeHost =
    options.runtimeHost ??
    createDefaultRuntimeHost({
      eventStores,
      artifacts,
      cwd: process.cwd(),
      agentDir: join(stateRoot, "pi"),
    });
  const security = options.security ?? new DaemonSecurity();

  app.use("/v0/*", async (context, next) => {
    const path = new URL(context.req.url).pathname;
    const origin = context.req.header("Origin");

    if (context.req.method === "OPTIONS") {
      if (origin !== security.allowedOrigin) {
        return securityErrorResponse("ORIGIN_FORBIDDEN", 403);
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, true),
      });
    }

    if (path === "/v0/health" && origin === undefined) {
      await next();
      return;
    }
    if (origin !== security.allowedOrigin) {
      return securityErrorResponse("ORIGIN_FORBIDDEN", 403);
    }

    if (path === "/v0/health") {
      await next();
      applyCorsHeaders(context, origin);
      return;
    }
    if (path !== "/v0/auth/bootstrap" && !security.authorizes(context.req.header("Cookie"))) {
      return securityErrorResponse("AUTH_REQUIRED", 401, origin);
    }
    await next();
    applyCorsHeaders(context, origin);
  });

  app.post("/v0/auth/bootstrap", (context) => {
    const response = {
      format: "loom.auth.v0",
      status: "ready",
    } satisfies LoomAuthResponse;
    context.header("Cache-Control", "no-store");
    context.header("Pragma", "no-cache");
    context.header("Set-Cookie", security.sessionCookie());
    return context.json(response);
  });

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

  app.post("/v0/projects/:projectId/sessions", async (context) => {
    try {
      const projectId = requireProjectId(context.req.param("projectId"));
      const request = await readJsonBody(context.req.raw);
      if (!isLoomCreateSessionRequest(request)) throw new RequestValidationError();
      const response = await runtimeHost.createSession({
        projectId,
        profile: request.profile,
        ...(request.title === undefined ? {} : { title: request.title }),
      });
      return context.json(response, 202);
    } catch (error) {
      return eventErrorResponse(error);
    }
  });

  app.post("/v0/sessions/:sessionId/messages", async (context) => {
    try {
      const projectId = requireProjectId(context.req.query("projectId"));
      const sessionId = requireSessionId(context.req.param("sessionId"));
      const request = await readJsonBody(context.req.raw);
      if (!isLoomSendMessageRequest(request)) throw new RequestValidationError();
      const response = await runtimeHost.sendMessage({
        projectId,
        sessionId,
        content: request.content,
      });
      return context.json(response, 202);
    } catch (error) {
      return eventErrorResponse(error);
    }
  });

  app.post("/v0/sessions/:sessionId/tasks/:taskId/cancel", async (context) => {
    try {
      const projectId = requireProjectId(context.req.query("projectId"));
      const sessionId = requireSessionId(context.req.param("sessionId"));
      const taskId = requireSessionId(context.req.param("taskId"));
      const request = await readJsonBody(context.req.raw);
      if (!isLoomCancelTaskRequest(request)) throw new RequestValidationError();
      const response = await runtimeHost.cancelTask({ projectId, sessionId, taskId });
      return context.json(response, 202);
    } catch (error) {
      return eventErrorResponse(error);
    }
  });

  app.get("/v0/views/:viewId", async (context) => {
    try {
      const projectId = requireProjectId(context.req.query("projectId"));
      const sessionId = requireSessionId(context.req.query("sessionId") ?? "");
      const view = await artifacts.readView({
        projectId,
        sessionId,
        viewId: context.req.param("viewId"),
      });
      return immutableJsonResponse(view, view.viewId);
    } catch (error) {
      return eventErrorResponse(error);
    }
  });

  app.get("/v0/blobs/:blobId", async (context) => {
    try {
      const projectId = requireProjectId(context.req.query("projectId"));
      const sessionId = requireSessionId(context.req.query("sessionId") ?? "");
      const viewId = context.req.query("viewId") ?? "";
      const blob = await artifacts.readBlobForView({
        projectId,
        sessionId,
        viewId,
        blobId: context.req.param("blobId"),
      });
      return immutableJsonResponse(blob, blob.blobId);
    } catch (error) {
      return eventErrorResponse(error);
    }
  });

  app.get("/v0/sessions/:sessionId/events", async (context) => {
    try {
      const projectId = requireProjectId(context.req.query("projectId"));
      const cursor = parseEventCursor(context.req.query("afterSequence"));
      const store = await eventStores.get(projectId, context.req.param("sessionId"));
      const response = {
        format: "loom.events.v0",
        events: [...(await store.replay(cursor))],
      } satisfies LoomEventsResponse;
      return context.json(response);
    } catch (error) {
      return eventErrorResponse(error);
    }
  });

  app.get("/v0/sessions/:sessionId/stream", async (context) => {
    try {
      const projectId = requireProjectId(context.req.query("projectId"));
      const queryCursor = context.req.query("afterSequence");
      const cursor = parseEventCursor(queryCursor ?? context.req.header("Last-Event-ID"));
      const store = await eventStores.get(projectId, context.req.param("sessionId"));
      const encoder = new TextEncoder();
      const pending: LoomEventEnvelope[] = [];
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let closed = false;
      let unsubscribe: () => void = () => undefined;

      const subscription = await store.subscribeAfter(cursor, (event) => {
        if (closed) return;
        if (controller === undefined) {
          pending.push(event);
          return;
        }
        try {
          controller.enqueue(encodeServerSentEvent(event, encoder));
        } catch {
          closed = true;
          unsubscribe();
        }
      });
      unsubscribe = subscription.unsubscribe;

      const stream = new ReadableStream<Uint8Array>({
        start(nextController) {
          controller = nextController;
          for (const event of subscription.replay) {
            nextController.enqueue(encodeServerSentEvent(event, encoder));
          }
          for (const event of pending) {
            nextController.enqueue(encodeServerSentEvent(event, encoder));
          }
          pending.length = 0;
        },
        cancel() {
          closed = true;
          unsubscribe();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      return eventErrorResponse(error);
    }
  });

  return app;
}

function applyCorsHeaders(context: { header(name: string, value: string): void }, origin: string) {
  context.header("Access-Control-Allow-Credentials", "true");
  context.header("Access-Control-Allow-Origin", origin);
  context.header("Vary", "Origin");
}

function corsHeaders(origin: string, preflight = false): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  });
  if (preflight) {
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function securityErrorResponse(
  code: "AUTH_REQUIRED" | "ORIGIN_FORBIDDEN",
  status: 401 | 403,
  allowedOrigin?: string,
): Response {
  const response = {
    format: "loom.error.v0",
    code,
    message:
      code === "AUTH_REQUIRED"
        ? "A valid daemon session is required"
        : "The request origin is not allowed",
  } satisfies LoomErrorResponse;
  return Response.json(response, {
    status,
    ...(allowedOrigin === undefined ? {} : { headers: corsHeaders(allowedOrigin) }),
  });
}

function requireProjectId(input: string | undefined): string {
  if (input === undefined || !isLoomPortableId(input)) {
    throw new SessionEventStoreError("INVALID_ID", "A project ID is required");
  }
  return input;
}

function requireSessionId(input: string): string {
  if (!isLoomPortableId(input)) {
    throw new SessionEventStoreError("INVALID_ID", "A portable ID is required");
  }
  return input;
}

class RequestValidationError extends Error {
  constructor() {
    super("The JSON request does not match the command schema");
    this.name = "RequestValidationError";
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const maximumBytes = 65_536;
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const bytes = Number(contentLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumBytes) {
      throw new RequestValidationError();
    }
  }
  if (request.body === null) throw new RequestValidationError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new RequestValidationError();
      }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new RequestValidationError();
  }
}

function parseEventCursor(input: string | undefined): number {
  if (input === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(input)) {
    throw new SessionEventStoreError("INVALID_CURSOR", "The event cursor is invalid");
  }
  const cursor = Number(input);
  if (!Number.isSafeInteger(cursor)) {
    throw new SessionEventStoreError("INVALID_CURSOR", "The event cursor is invalid");
  }
  return cursor;
}

function encodeServerSentEvent(event: LoomEventEnvelope, encoder: TextEncoder): Uint8Array {
  return encoder.encode(
    `id: ${event.sequence}\nevent: loom.event\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

function immutableJsonResponse(input: unknown, identity: string): Response {
  return new Response(canonicalJson(input), {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": "application/json; charset=utf-8",
      ETag: `"${identity}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function eventErrorResponse(error: unknown): Response {
  let status = 500;
  let code: LoomErrorCode = "INTERNAL_ERROR";
  let message = "The daemon could not complete the request";

  if (error instanceof RequestValidationError) {
    status = 400;
    code = "INVALID_REQUEST";
    message = "The command request is invalid";
  } else if (error instanceof RuntimeAdapterError) {
    code = error.code;
    if (error.code === "SESSION_NOT_FOUND" || error.code === "TASK_NOT_FOUND") {
      status = 404;
      message =
        error.code === "SESSION_NOT_FOUND" ? "The session was not found" : "The task was not found";
    } else if (error.code === "RUNTIME_UNAVAILABLE") {
      status = 503;
      message = "The requested runtime is unavailable";
    } else {
      status = 409;
      message =
        error.code === "PROFILE_UNAVAILABLE"
          ? "The requested profile is not available"
          : "The command conflicts with the current runtime state";
    }
  } else if (error instanceof ResearchArtifactError) {
    if (error.code === "INVALID_ID") {
      status = 400;
      code = "INVALID_REQUEST";
      message = "The resource request is invalid";
    } else if (error.code === "VIEW_NOT_FOUND" || error.code === "BLOB_NOT_FOUND") {
      status = 404;
      code = error.code;
      message =
        error.code === "VIEW_NOT_FOUND" ? "The view was not found" : "The blob was not found";
    } else {
      status = 503;
      code = "VIEW_UNAVAILABLE";
      message = "The research view is unavailable";
    }
  } else if (error instanceof SessionEventStoreError) {
    if (error.code === "INVALID_ID" || error.code === "INVALID_CURSOR") {
      status = 400;
      code = "INVALID_REQUEST";
      message = "The event request is invalid";
    } else if (error.code === "EVENT_CURSOR_AHEAD") {
      status = 409;
      code = "EVENT_CURSOR_AHEAD";
      message = "The requested event cursor is ahead of this session";
    } else {
      status = 503;
      code = "EVENT_LOG_UNAVAILABLE";
      message = "The session event log is unavailable";
    }
  }

  const response = {
    format: "loom.error.v0",
    code,
    message,
  } satisfies LoomErrorResponse;
  return Response.json(response, { status });
}
