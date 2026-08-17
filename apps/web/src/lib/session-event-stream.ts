import { isLoomEventEnvelope } from "@veilquant/loom-protocol";
import {
  applySessionEvent,
  createSessionProjection,
  type SessionProjection,
  withProtocolIssue,
} from "./session-projection";

export type SessionConnectionStatus = "connecting" | "live" | "reconnecting" | "failed";

export interface SessionConnectionState {
  status: SessionConnectionStatus;
  attempt: number;
}

export interface EventSourcePort {
  onOpen(listener: () => void): void;
  onError(listener: () => void): void;
  onEvent(listener: (data: string, lastEventId: string) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourcePort;

export interface StreamScheduler {
  schedule(task: () => void, delayMilliseconds: number): unknown;
  cancel(handle: unknown): void;
}

export interface SessionEventStreamOptions {
  basePath: string;
  projectId: string;
  sessionId: string;
  onProjection: (projection: SessionProjection) => void;
  onConnection: (connection: SessionConnectionState) => void;
  authorize?: () => Promise<void>;
  eventSourceFactory?: EventSourceFactory;
  scheduler?: StreamScheduler;
  retryDelayMilliseconds?: number;
}

export class SessionEventStream {
  readonly #options: SessionEventStreamOptions;
  readonly #factory: EventSourceFactory;
  readonly #scheduler: StreamScheduler;
  readonly #retryDelayMilliseconds: number;
  #projection: SessionProjection;
  #source: EventSourcePort | undefined;
  #retryHandle: unknown;
  #attempt = 0;
  #started = false;

  constructor(options: SessionEventStreamOptions) {
    this.#options = options;
    this.#factory = options.eventSourceFactory ?? browserEventSourceFactory;
    this.#scheduler = options.scheduler ?? browserScheduler;
    this.#retryDelayMilliseconds = options.retryDelayMilliseconds ?? 750;
    this.#projection = createSessionProjection(options.projectId, options.sessionId);
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#options.onProjection(this.#projection);
    this.#options.onConnection({ status: "connecting", attempt: 0 });
    if (this.#options.authorize === undefined) this.#connect();
    else void this.#authorizeAndConnect();
  }

  stop(): void {
    this.#started = false;
    this.#source?.close();
    this.#source = undefined;
    if (this.#retryHandle !== undefined) {
      this.#scheduler.cancel(this.#retryHandle);
      this.#retryHandle = undefined;
    }
  }

  #connect(): void {
    if (!this.#started) return;
    let source: EventSourcePort;
    try {
      source = this.#factory(
        sessionStreamUrl(
          this.#options.basePath,
          this.#options.projectId,
          this.#options.sessionId,
          this.#projection.lastSequence,
        ),
      );
    } catch {
      this.#scheduleReconnect(this.#retryDelay());
      return;
    }
    this.#source = source;

    source.onOpen(() => {
      if (this.#source !== source || !this.#started) return;
      this.#attempt = 0;
      this.#options.onConnection({ status: "live", attempt: 0 });
    });
    source.onError(() => {
      if (this.#source !== source || !this.#started) return;
      source.close();
      this.#source = undefined;
      this.#scheduleReconnect(this.#retryDelay());
    });
    source.onEvent((data, lastEventId) => {
      if (this.#source !== source || !this.#started) return;
      this.#receive(data, lastEventId, source);
    });
  }

  #receive(data: string, lastEventId: string, source: EventSourcePort): void {
    let input: unknown;
    try {
      input = JSON.parse(data);
    } catch {
      this.#fail("The daemon sent malformed event JSON.", source);
      return;
    }
    if (!isLoomEventEnvelope(input)) {
      this.#fail("The daemon sent an event outside the supported protocol.", source);
      return;
    }
    if (lastEventId !== String(input.sequence)) {
      this.#fail("The SSE event ID does not match the session sequence.", source);
      return;
    }

    const result = applySessionEvent(this.#projection, input);
    this.#projection = result.state;
    this.#options.onProjection(this.#projection);

    if (result.outcome === "gap") {
      source.close();
      this.#source = undefined;
      this.#scheduleReconnect(0);
    } else if (result.outcome === "rejected") {
      this.#stopWithFailure(source);
    }
  }

  #fail(message: string, source: EventSourcePort): void {
    this.#projection = withProtocolIssue(this.#projection, message);
    this.#options.onProjection(this.#projection);
    this.#stopWithFailure(source);
  }

  #stopWithFailure(source: EventSourcePort): void {
    source.close();
    this.#source = undefined;
    this.#started = false;
    this.#options.onConnection({ status: "failed", attempt: this.#attempt });
  }

  #scheduleReconnect(delayMilliseconds: number): void {
    if (!this.#started || this.#retryHandle !== undefined) return;
    this.#attempt += 1;
    this.#options.onConnection({ status: "reconnecting", attempt: this.#attempt });
    this.#retryHandle = this.#scheduler.schedule(() => {
      this.#retryHandle = undefined;
      if (this.#options.authorize === undefined) this.#connect();
      else void this.#authorizeAndConnect();
    }, delayMilliseconds);
  }

  async #authorizeAndConnect(): Promise<void> {
    if (!this.#started || this.#options.authorize === undefined) return;
    try {
      await this.#options.authorize();
    } catch {
      if (this.#started) this.#scheduleReconnect(this.#retryDelay());
      return;
    }
    if (this.#started) this.#connect();
  }

  #retryDelay(): number {
    const multiplier = Math.min(2 ** this.#attempt, 8);
    return this.#retryDelayMilliseconds * multiplier;
  }
}

export function sessionStreamUrl(
  basePath: string,
  projectId: string,
  sessionId: string,
  afterSequence: number,
): string {
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const query = new URLSearchParams({ projectId, afterSequence: String(afterSequence) });
  return `${normalizedBase}/v0/sessions/${encodeURIComponent(sessionId)}/stream?${query.toString()}`;
}

const browserScheduler: StreamScheduler = {
  schedule: (task, delayMilliseconds) => globalThis.setTimeout(task, delayMilliseconds),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function browserEventSourceFactory(url: string): EventSourcePort {
  const source = new EventSource(url, { withCredentials: true });
  return {
    onOpen(listener) {
      source.addEventListener("open", listener);
    },
    onError(listener) {
      source.addEventListener("error", listener);
    },
    onEvent(listener) {
      source.addEventListener("loom.event", (event) => {
        if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
        listener(event.data, event.lastEventId);
      });
    },
    close() {
      source.close();
    },
  };
}
