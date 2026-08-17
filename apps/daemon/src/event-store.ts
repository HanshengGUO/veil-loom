import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  isLoomEventEnvelope,
  isLoomPortableId,
  type LoomEventEnvelope,
  type LoomEventPayload,
  type LoomEventType,
} from "@veilquant/loom-protocol";

export type SessionEventStoreErrorCode =
  | "INVALID_ID"
  | "INVALID_CURSOR"
  | "EVENT_CURSOR_AHEAD"
  | "EVENT_LOG_TRUNCATED"
  | "EVENT_LOG_CORRUPT"
  | "EVENT_SEQUENCE_INVALID"
  | "EVENT_LOG_WRITE_FAILED";

export class SessionEventStoreError extends Error {
  readonly code: SessionEventStoreErrorCode;

  constructor(code: SessionEventStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionEventStoreError";
    this.code = code;
  }
}

export interface SessionEventStoreOptions {
  stateRoot: string;
  projectId: string;
  sessionId: string;
  clock?: () => string;
  eventId?: () => string;
}

export interface AppendEventInput {
  type: LoomEventType;
  payload: LoomEventPayload;
}

export type SessionEventListener = (event: LoomEventEnvelope) => void;

export interface SessionEventSubscription {
  replay: readonly LoomEventEnvelope[];
  unsubscribe: () => void;
}

/**
 * An append-only, per-session event log.
 *
 * Every operation is serialized through one queue. An append is fsynced before the event becomes
 * visible in memory or to subscribers, so a browser can never observe an event that recovery
 * cannot replay.
 */
export class SessionEventStore {
  readonly projectId: string;
  readonly sessionId: string;

  readonly #clock: () => string;
  readonly #eventId: () => string;
  readonly #logPath: string;
  readonly #events: LoomEventEnvelope[];
  readonly #eventIds: Set<string>;
  readonly #listeners = new Set<SessionEventListener>();
  #queue: Promise<void> = Promise.resolve();

  private constructor(options: SessionEventStoreOptions, events: LoomEventEnvelope[]) {
    this.projectId = options.projectId;
    this.sessionId = options.sessionId;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#eventId = options.eventId ?? (() => `evt_${randomUUID()}`);
    this.#logPath = eventLogPath(options.stateRoot, options.projectId, options.sessionId);
    this.#events = events;
    this.#eventIds = new Set(events.map((event) => event.eventId));
  }

  static async open(options: SessionEventStoreOptions): Promise<SessionEventStore> {
    assertPortableId(options.projectId);
    assertPortableId(options.sessionId);
    const logPath = eventLogPath(options.stateRoot, options.projectId, options.sessionId);
    const contents = await readEventLog(logPath);
    const events = parseEventLog(contents, options.projectId, options.sessionId);
    return new SessionEventStore(options, events);
  }

  append(input: AppendEventInput): Promise<LoomEventEnvelope> {
    return this.#serialize(async () => {
      const event: LoomEventEnvelope = {
        format: "loom.event.v0",
        eventId: this.#eventId(),
        projectId: this.projectId,
        sessionId: this.sessionId,
        sequence: this.#events.length + 1,
        occurredAt: this.#clock(),
        type: input.type,
        payload: input.payload,
      };

      if (!isLoomEventEnvelope(event)) {
        throw new SessionEventStoreError(
          "EVENT_LOG_WRITE_FAILED",
          "The event is not valid JSON protocol data",
        );
      }
      if (this.#eventIds.has(event.eventId)) {
        throw new SessionEventStoreError(
          "EVENT_LOG_WRITE_FAILED",
          "The event identifier is already present in this session",
        );
      }

      const snapshot = parseSnapshot(JSON.stringify(event));

      try {
        await appendLineDurably(this.#logPath, JSON.stringify(snapshot));
      } catch (error) {
        throw new SessionEventStoreError(
          "EVENT_LOG_WRITE_FAILED",
          "The event could not be durably written",
          { cause: error },
        );
      }

      const immutable = deepFreeze(snapshot);
      this.#events.push(immutable);
      this.#eventIds.add(immutable.eventId);
      for (const listener of this.#listeners) {
        try {
          listener(immutable);
        } catch {
          // A consumer cannot roll back or invalidate an event that is already durable.
        }
      }
      return immutable;
    });
  }

  replay(afterSequence = 0): Promise<readonly LoomEventEnvelope[]> {
    return this.#serialize(async () => {
      assertCursor(afterSequence, this.#events.length);
      return this.#events.slice(afterSequence);
    });
  }

  subscribeAfter(
    afterSequence: number,
    listener: SessionEventListener,
  ): Promise<SessionEventSubscription> {
    return this.#serialize(async () => {
      assertCursor(afterSequence, this.#events.length);
      const replay = this.#events.slice(afterSequence);
      this.#listeners.add(listener);
      let subscribed = true;
      return {
        replay,
        unsubscribe: () => {
          if (!subscribed) return;
          subscribed = false;
          this.#listeners.delete(listener);
        },
      };
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface SessionEventStoreRegistryOptions {
  stateRoot: string;
  clock?: () => string;
  eventId?: () => string;
}

export interface DurableSessionIdentity {
  projectId: string;
  sessionId: string;
}

export class SessionEventStoreRegistry {
  readonly stateRoot: string;
  readonly #options: SessionEventStoreRegistryOptions;
  readonly #stores = new Map<string, Promise<SessionEventStore>>();

  constructor(options: SessionEventStoreRegistryOptions) {
    this.stateRoot = options.stateRoot;
    this.#options = options;
  }

  get(projectId: string, sessionId: string): Promise<SessionEventStore> {
    assertPortableId(projectId);
    assertPortableId(sessionId);
    const key = `${projectId}\0${sessionId}`;
    const existing = this.#stores.get(key);
    if (existing !== undefined) return existing;

    const store = SessionEventStore.open({
      stateRoot: this.#options.stateRoot,
      projectId,
      sessionId,
      ...(this.#options.clock === undefined ? {} : { clock: this.#options.clock }),
      ...(this.#options.eventId === undefined ? {} : { eventId: this.#options.eventId }),
    });
    this.#stores.set(key, store);
    store.catch(() => this.#stores.delete(key));
    return store;
  }

  async discover(): Promise<readonly DurableSessionIdentity[]> {
    const projectsRoot = join(this.stateRoot, "projects");
    const projects = await readDirectory(projectsRoot);
    const identities: DurableSessionIdentity[] = [];
    for (const project of projects) {
      if (!project.isDirectory() || !isLoomPortableId(project.name)) continue;
      const sessionsRoot = join(projectsRoot, project.name, "sessions");
      const sessions = await readDirectory(sessionsRoot);
      for (const session of sessions) {
        if (!session.isDirectory() || !isLoomPortableId(session.name)) continue;
        const logPath = eventLogPath(this.stateRoot, project.name, session.name);
        try {
          const metadata = await lstat(logPath);
          if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
        } catch (error) {
          if (isNodeError(error) && error.code === "ENOENT") continue;
          throw new SessionEventStoreError(
            "EVENT_LOG_CORRUPT",
            "A durable session could not be inspected",
            { cause: error },
          );
        }
        identities.push({ projectId: project.name, sessionId: session.name });
      }
    }
    return identities.sort((left, right) =>
      left.projectId === right.projectId
        ? left.sessionId.localeCompare(right.sessionId)
        : left.projectId.localeCompare(right.projectId),
    );
  }
}

async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw new SessionEventStoreError(
      "EVENT_LOG_CORRUPT",
      "The durable session directory could not be inspected",
      { cause: error },
    );
  }
}

function eventLogPath(stateRoot: string, projectId: string, sessionId: string): string {
  return join(stateRoot, "projects", projectId, "sessions", sessionId, "events.jsonl");
}

async function readEventLog(logPath: string): Promise<string | undefined> {
  try {
    return await readFile(logPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw new SessionEventStoreError("EVENT_LOG_CORRUPT", "The event log could not be read", {
      cause: error,
    });
  }
}

function parseEventLog(
  contents: string | undefined,
  projectId: string,
  sessionId: string,
): LoomEventEnvelope[] {
  if (contents === undefined || contents.length === 0) return [];
  if (!contents.endsWith("\n")) {
    throw new SessionEventStoreError("EVENT_LOG_TRUNCATED", "The event log ends mid-record");
  }

  const lines = contents.slice(0, -1).split("\n");
  const eventIds = new Set<string>();
  return lines.map((line, index) => {
    let input: unknown;
    try {
      input = JSON.parse(line);
    } catch (error) {
      throw new SessionEventStoreError("EVENT_LOG_CORRUPT", "The event log contains invalid JSON", {
        cause: error,
      });
    }

    if (!isLoomEventEnvelope(input)) {
      throw new SessionEventStoreError(
        "EVENT_LOG_CORRUPT",
        "The event log contains an invalid record",
      );
    }
    if (input.projectId !== projectId || input.sessionId !== sessionId) {
      throw new SessionEventStoreError(
        "EVENT_LOG_CORRUPT",
        "The event log contains a record for another session",
      );
    }
    if (input.sequence !== index + 1) {
      throw new SessionEventStoreError(
        "EVENT_SEQUENCE_INVALID",
        "The event log sequence is not contiguous",
      );
    }
    if (eventIds.has(input.eventId)) {
      throw new SessionEventStoreError(
        "EVENT_LOG_CORRUPT",
        "The event log contains a duplicate event identifier",
      );
    }
    eventIds.add(input.eventId);
    return deepFreeze(input);
  });
}

async function appendLineDurably(logPath: string, line: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  const handle = await open(logPath, "a", 0o600);
  let failure: unknown;
  let synced = false;
  try {
    await handle.writeFile(`${line}\n`, "utf8");
    await handle.sync();
    synced = true;
  } catch (error) {
    failure = error;
  }

  try {
    await handle.close();
  } catch (error) {
    // Once fsync succeeds, a close error cannot make the already durable event disappear. Treating
    // it as a failed append would let the next event reuse the same sequence.
    if (!synced && failure === undefined) failure = error;
  }

  if (failure !== undefined) throw failure;
}

function parseSnapshot(serialized: string): LoomEventEnvelope {
  const input: unknown = JSON.parse(serialized);
  if (!isLoomEventEnvelope(input)) {
    throw new SessionEventStoreError(
      "EVENT_LOG_WRITE_FAILED",
      "The serialized event failed protocol validation",
    );
  }
  return input;
}

function assertPortableId(input: string): void {
  if (!isLoomPortableId(input)) {
    throw new SessionEventStoreError("INVALID_ID", "Project and session IDs must be portable IDs");
  }
}

function assertCursor(cursor: number, latestSequence: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new SessionEventStoreError(
      "INVALID_CURSOR",
      "The event cursor must be a non-negative integer",
    );
  }
  if (cursor > latestSequence) {
    throw new SessionEventStoreError(
      "EVENT_CURSOR_AHEAD",
      "The event cursor is ahead of the durable log",
    );
  }
}

function deepFreeze<T>(input: T): T {
  if (input !== null && typeof input === "object") {
    for (const value of Object.values(input)) deepFreeze(value);
    Object.freeze(input);
  }
  return input;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
