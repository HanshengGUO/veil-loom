# Protocol

The protocol package is the only contract shared by the browser and daemon. It contains exact
TypeBox schemas and TypeScript types without network, filesystem, React, Pi, or Veil dependencies.

The initial contract defines:

- session profiles and capabilities;
- assurance states and their allowed issuer;
- daemon health and profile discovery responses;
- ordered session events, replay responses, and redacted errors.

## Session events

Every event uses the `loom.event.v0` envelope:

```json
{
  "format": "loom.event.v0",
  "eventId": "evt_1d36db79-e557-4f65-aea5-b12313bc7671",
  "projectId": "demo-project",
  "sessionId": "session-1",
  "sequence": 1,
  "occurredAt": "2026-08-17T10:00:00.000Z",
  "type": "session.created",
  "payload": { "profile": "raw-pi" }
}
```

Sequence numbers start at one and are contiguous within a session. The daemon validates JSON-safe
payloads, writes and syncs each event before notifying subscribers, and refuses to open a truncated,
corrupt, or non-contiguous log. Project, session, and event IDs use a portable character set so they
cannot turn into filesystem paths.

The read API is cursor-based:

```text
GET /v0/sessions/:sessionId/events?projectId=:projectId&afterSequence=:sequence
GET /v0/sessions/:sessionId/stream?projectId=:projectId&afterSequence=:sequence
```

The first route returns `loom.events.v0` JSON. The second emits `loom.event` server-sent events with
the session sequence as the SSE `id`. A reconnect may send `Last-Event-ID` instead of
`afterSequence`. A cursor beyond the durable tail returns `EVENT_CURSOR_AHEAD`; the daemon never
guesses or skips ahead.

A consumer applies only `lastSequence + 1`. It may ignore an exact duplicate, but reusing a sequence
or event ID with different content is a protocol conflict. If sequence 12 arrives after sequence 10,
the consumer must not apply it or let the browser's implicit SSE cursor advance recovery past 11. It
closes the connection and explicitly requests replay after 10.

Large chart series will be referenced as immutable blobs rather than repeated in an unbounded event
log.

## Assurance

Loom may issue only `exploratory` assurance. Contract and Experiment states must be independently
derived from validated Veil records. The browser never infers assurance from a metric, process exit
code, model message, or visual similarity.
