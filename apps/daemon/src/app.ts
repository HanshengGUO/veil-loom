import {
  LOOM_PROFILE_DESCRIPTORS,
  type LoomCapabilitiesResponse,
  type LoomErrorCode,
  type LoomErrorResponse,
  type LoomEventEnvelope,
  type LoomEventsResponse,
  type LoomHealthResponse,
} from "@veilquant/loom-protocol";
import { Hono } from "hono";
import { SessionEventStoreError, SessionEventStoreRegistry } from "./event-store.js";
import { resolveLoomStateRoot } from "./state-root.js";

const DAEMON_VERSION = "0.0.0";

export interface LoomAppOptions {
  eventStores?: SessionEventStoreRegistry;
}

export function createLoomApp(options: LoomAppOptions = {}): Hono {
  const app = new Hono();
  const eventStores =
    options.eventStores ?? new SessionEventStoreRegistry({ stateRoot: resolveLoomStateRoot() });

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

function requireProjectId(input: string | undefined): string {
  if (input === undefined || input.length === 0) {
    throw new SessionEventStoreError("INVALID_ID", "A project ID is required");
  }
  return input;
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

function eventErrorResponse(error: unknown): Response {
  let status = 500;
  let code: LoomErrorCode = "INTERNAL_ERROR";
  let message = "The daemon could not complete the request";

  if (error instanceof SessionEventStoreError) {
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
