import type { LoomEventEnvelope, LoomEventType } from "@veilquant/loom-protocol";
import { describe, expect, it } from "vitest";
import {
  type EventSourcePort,
  SessionEventStream,
  type StreamScheduler,
} from "../src/lib/session-event-stream";
import type { SessionProjection } from "../src/lib/session-projection";

describe("session event stream", () => {
  it("authenticates before opening and re-authenticates after disconnect", async () => {
    let authorizations = 0;
    const fixture = streamFixture({
      authorize: async () => {
        authorizations += 1;
      },
    });
    fixture.stream.start();
    expect(fixture.sources).toHaveLength(0);
    await Promise.resolve();

    expect(authorizations).toBe(1);
    expect(fixture.sources[0]?.url).toContain("afterSequence=0");
    fixture.sources[0]?.emit(event(1, "session.created", {}));
    fixture.sources[0]?.emitError();
    fixture.scheduler.runNext();
    await Promise.resolve();

    expect(authorizations).toBe(2);
    expect(fixture.sources[1]?.url).toContain("afterSequence=1");
  });

  it("reconnects from the last applied cursor after a network error", () => {
    const fixture = streamFixture();
    fixture.stream.start();
    expect(fixture.sources[0]?.url).toContain("afterSequence=0");

    fixture.sources[0]?.emitOpen();
    fixture.sources[0]?.emit(event(1, "session.created", {}));
    fixture.sources[0]?.emitError();
    expect(fixture.connections.at(-1)).toMatchObject({ status: "reconnecting", attempt: 1 });

    fixture.scheduler.runNext();
    expect(fixture.sources[1]?.url).toContain("afterSequence=1");
    fixture.sources[1]?.emit(event(2, "session.ready", {}));
    expect(fixture.projections.at(-1)?.lastSequence).toBe(2);
  });

  it("closes a gapped stream and explicitly replays from the safe cursor", () => {
    const fixture = streamFixture();
    fixture.stream.start();
    fixture.sources[0]?.emit(event(1, "session.created", {}));
    fixture.sources[0]?.emit(event(3, "session.ready", {}));

    expect(fixture.sources[0]?.closed).toBe(true);
    expect(fixture.projections.at(-1)).toMatchObject({
      lastSequence: 1,
      issue: { kind: "gap", expectedSequence: 2 },
    });
    fixture.scheduler.runNext();
    expect(fixture.sources[1]?.url).toContain("afterSequence=1");

    fixture.sources[1]?.emit(event(2, "message.user_appended", { content: "Recovered" }));
    fixture.sources[1]?.emit(event(3, "session.ready", {}));
    expect(fixture.projections.at(-1)).toMatchObject({ lastSequence: 3, status: "ready" });
    expect(fixture.projections.at(-1)?.issue).toBeUndefined();
  });

  it("fails closed when the SSE id and protocol envelope disagree", () => {
    const fixture = streamFixture();
    fixture.stream.start();
    fixture.sources[0]?.emit(event(1, "session.created", {}), "2");

    expect(fixture.connections.at(-1)).toMatchObject({ status: "failed" });
    expect(fixture.projections.at(-1)?.issue).toMatchObject({ kind: "protocol" });
    expect(fixture.scheduler.pending).toHaveLength(0);
  });
});

function streamFixture(options: { authorize?: () => Promise<void> } = {}) {
  const sources: FakeEventSource[] = [];
  const projections: SessionProjection[] = [];
  const connections: Array<{ status: string; attempt: number }> = [];
  const scheduler = new FakeScheduler();
  const stream = new SessionEventStream({
    basePath: "/loom-daemon",
    projectId: "project-a",
    sessionId: "session-a",
    onProjection: (projection) => projections.push(projection),
    onConnection: (connection) => connections.push(connection),
    ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
    eventSourceFactory: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    scheduler,
  });
  return { stream, sources, projections, connections, scheduler };
}

class FakeEventSource implements EventSourcePort {
  readonly url: string;
  closed = false;
  #open: (() => void) | undefined;
  #error: (() => void) | undefined;
  #event: ((data: string, lastEventId: string) => void) | undefined;

  constructor(url: string) {
    this.url = url;
  }

  onOpen(listener: () => void): void {
    this.#open = listener;
  }

  onError(listener: () => void): void {
    this.#error = listener;
  }

  onEvent(listener: (data: string, lastEventId: string) => void): void {
    this.#event = listener;
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.#open?.();
  }

  emitError(): void {
    this.#error?.();
  }

  emit(event: LoomEventEnvelope, lastEventId = String(event.sequence)): void {
    this.#event?.(JSON.stringify(event), lastEventId);
  }
}

class FakeScheduler implements StreamScheduler {
  readonly pending: Array<() => void> = [];

  schedule(task: () => void): unknown {
    this.pending.push(task);
    return task;
  }

  cancel(handle: unknown): void {
    const index = this.pending.indexOf(handle as () => void);
    if (index >= 0) this.pending.splice(index, 1);
  }

  runNext(): void {
    const task = this.pending.shift();
    if (task === undefined) throw new Error("No reconnect was scheduled");
    task();
  }
}

function event(
  sequence: number,
  type: LoomEventType,
  payload: Record<string, unknown>,
): LoomEventEnvelope {
  return {
    format: "loom.event.v0",
    eventId: `evt-${sequence}`,
    projectId: "project-a",
    sessionId: "session-a",
    sequence,
    occurredAt: "2026-08-17T10:00:00.000Z",
    type,
    payload,
  };
}
