# Protocol

The protocol package is the only contract shared by the browser and daemon. It contains exact
TypeBox schemas and TypeScript types without network, filesystem, React, Pi, or Veil dependencies.

The initial contract defines:

- session profiles and capabilities;
- assurance states and their allowed issuer;
- daemon health and profile discovery responses;
- ordered session events, replay responses, and redacted errors.

## Daemon session

The bootstrap route requires the configured exact Origin. After bootstrap, browser-facing routes
other than health and CORS preflight require both that Origin and a valid daemon-session cookie. The
browser starts with:

```text
POST /v0/auth/bootstrap
Origin: http://127.0.0.1:3000
```

The successful JSON response contains no credential:

```json
{ "format": "loom.auth.v0", "status": "ready" }
```

The startup secret is delivered only in an HttpOnly, SameSite session cookie. It is generated from
256 bits of randomness for each daemon process, never accepted in a query parameter, and invalid
after restart. Missing or invalid credentials return `AUTH_REQUIRED`; an absent or mismatched Origin
returns `ORIGIN_FORBIDDEN`. The daemon never uses `Access-Control-Allow-Origin: *`.

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

Chart series are referenced as immutable blobs rather than repeated in an unbounded event log. A
`view.published` event carries an exact `loom.view-published.v0` descriptor, not series values.

## Backtest views

The first adapter boundary is `loom.backtest-import.v0`. It requires one time unit across ordered
market, equity, drawdown, trade, and region values. Time is represented as a signed decimal epoch
string plus `ms`, `us`, or `ns`; consumers compare it without converting through an unsafe
JavaScript number. Every metric supplies a stable key, value or text, unit, scale, sample scope, and
method.

A valid import becomes:

- `loom.backtest-view.v0` metadata with exploratory assurance and project/session/task provenance;
- `loom.blob.v0` envelopes containing `loom.series.v0` OHLCV or scalar data;
- a `loom.blob.v0` envelope containing a `loom.table.v0` trade table.

Blob IDs are SHA-256 hashes of canonical content bytes. View IDs hash canonical view content before
the ID is attached. The v0 JSON path permits at most 4,096 items per series, 256 KiB per blob,
1 MiB of references per view, and 64 KiB of view metadata. Arrow IPC and larger paged or ranged
resources are not silently accepted; they require a later protocol version.

Protected reads bind every resource to the durable view ownership tuple:

```text
GET /v0/views/:viewId?projectId=:projectId&sessionId=:sessionId
GET /v0/blobs/:blobId?projectId=:projectId&sessionId=:sessionId&viewId=:viewId
```

The blob route serves only a blob referenced by that owned view. Unknown, cross-session, corrupt, or
identity-mismatched resources fail closed. The reference adapter can issue only evidence-free
exploratory assurance; ordinary Pi tool output is never inferred to be a view.

## Commands

Mutations use exact, versioned JSON bodies and return `202 Accepted` with a generated command ID:

```text
POST /v0/projects/:projectId/sessions
POST /v0/sessions/:sessionId/messages?projectId=:projectId
POST /v0/sessions/:sessionId/tasks/:taskId/cancel?projectId=:projectId
```

The corresponding body formats are `loom.session.create.v0`, `loom.message.send.v0`, and
`loom.task.cancel.v0`. Unknown fields, blank messages, oversized bodies, non-portable IDs, and
unavailable profiles fail closed. A successful response uses `loom.command.accepted.v0`; a message
or cancellation response also carries the task ID. Completion never depends on the HTTP connection:
it is reported by the ordered event stream.

The Raw Pi adapter maps public text deltas, assistant completion, and coarse tool/task state. It does
not expose model thinking, tool arguments, tool result bodies, or provider diagnostics. The
`loom.pi-runtime.v0` descriptor records package version, provider, model, mode, and a non-secret
fingerprint so a replay remains attributable.

## Assurance

Loom may issue only `exploratory` assurance. Contract and Experiment states must be independently
derived from validated Veil records. The browser never infers assurance from a metric, process exit
code, model message, or visual similarity.
