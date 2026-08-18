# Protocol

The protocol package is the only contract shared by the browser and daemon. It contains exact
TypeBox schemas and TypeScript types without network, filesystem, React, Pi, or Veil dependencies.

The initial contract defines:

- session profiles and capabilities;
- Veil runtime and project readiness;
- minimal Raw-to-Veil promotion commands and exact verification records;
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

## Project readiness

The protected, non-cacheable readiness route is:

```text
GET /v0/projects/:projectId
```

A ready project returns an exact `loom.project-readiness.v0` record:

```json
{
  "format": "loom.project-readiness.v0",
  "projectId": "daily-factor-demo",
  "profile": "veil",
  "status": "ready",
  "runtime": {
    "package": "veil-quant",
    "installedVersion": "0.1.0",
    "supportedRange": ">=0.1.0 <0.2.0",
    "detectedFormats": ["veil.project.v0"]
  },
  "capabilities": [
    "chat",
    "local-code",
    "loom-chart",
    "loom-selection",
    "task-cancel",
    "session-replay",
    "veil-data",
    "veil-promotion",
    "veil-experiment",
    "veil-reproduction"
  ],
  "project": {
    "format": "veil.project.v0",
    "datasetCount": 1,
    "runtimeCount": 1,
    "promotionConcurrency": 2,
    "costModelCount": 1,
    "nullGeneratorCount": 1
  }
}
```

`invalid` and `unavailable` responses have no project summary or capabilities. They carry one
bounded public issue with `code`, `message`, and `remedy`. A response never includes an absolute
root, source locator, dataset ID, environment name, or raw data. Unknown fields, forged ownership,
reordered capabilities, and contradictory status fields fail protocol validation.

Readiness says only that the Veil profile can load. It does not create a verification attempt,
Experiment, evidence reference, or non-exploratory assurance. Creating a Veil session while the
project is not ready returns `PROJECT_NOT_READY` without creating a durable session.

## Veil verification attempts

Promotion starts from a Raw Pi session:

```text
POST /v0/sessions/:sourceSessionId/promotions?projectId=:projectId
```

The exact request is intentionally smaller than a Veil promotion request:

```json
{
  "format": "loom.promotion.create.v0",
  "viewId": "view_<sha256>",
  "artifactReference": "artifact/daily-factor.mjs",
  "hypothesis": {
    "statement": "The factor remains positive out of sample after costs."
  }
}
```

`artifactReference` is a normalized, portable path beneath the daemon-owned project root. Absolute
paths, backslashes, empty or dot segments, control characters, and unknown fields fail closed. The
schema has no fields for Raw metrics, expected values, data locators, protocol settings, gates, or
assurance.

After the source view, task topology, adapter identity, and artifact digest are checked, the daemon
returns `loom.promotion.accepted.v0`. Its `sourceSessionId` identifies the unchanged Raw session;
`sessionId` identifies a newly created Veil session and must differ. It also carries the new task and
attempt IDs.

The target stream uses three exact payloads:

- `loom.veil-verification-started.v0` records `derived-from-exploration`, the source view/session,
  selected artifact identity, and Veil hypothesis reference;
- `loom.veil-stage-changed.v0` reports only the completed development-data read and
  running/completed independent verification. The panel read establishes an observed development
  read-set; it remains exploration-grade and is not verification evidence by itself;
- `loom.veil-experiment-recorded.v0` records the Experiment/archive identity, structural hashes,
  execution count, registration status, verdict, claim status, and exact Veil assurance.

The final payload is valid only when `accepted → verified`, `degraded → degraded`, or
`rejected → rejected`, and its assurance evidence is exactly the Experiment ID plus verified archive
hash. Events must arrive in attempt/stage order and match the target task. The browser reducer stops
on malformed, reordered, cross-attempt, or forged evidence.

An `ok: false` Veil result or execution exception ends in `task.failed`; it does not produce
`veil.experiment_recorded` and must not be rendered as rejected. Cancellation ends in
`task.cancelled`. A restart with no task terminal follows the normal `task.interrupted` rule and is
never resumed or guessed successful.

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

### Restart reconciliation

The event log, rather than Pi's private conversation file, decides whether a task completed. During
daemon startup an open durable session follows this ordered recovery record:

1. `session.status_changed` with `status: "recovering"`;
2. one `task.interrupted` for each task that has no durable terminal event;
3. `session.status_changed` with `status: "ready"` and `recovery: "resumed"` or
   `"reconstructed"`, but only after the runtime is usable again.

`task.interrupted` is terminal. Its stable `DAEMON_RESTART` code means that no successful terminal
record exists and the request must be retried. A session that crashed before its first
`session.ready` instead ends with `SESSION_START_INTERRUPTED` and is not made executable. Runtime
restore failures end with `PI_RECOVERY_FAILED`; public records contain a remedy but no provider
diagnostics or local path.

The `reconstructed` compatibility mode uses only a bounded recent transcript of public user events
and completed assistant messages. It does not replay partial deltas, tools, views, selections, or
hidden model context. Neither recovery mode may synthesize `task.completed`.

## Chart selections

The browser creates selection context with:

```text
POST /v0/sessions/:sessionId/selections?projectId=:projectId
```

The exact `loom.selection.create.v0` body contains `viewId`, `from`, `until`, and one or more visible
`seriesKeys`. It has no summary field. Unknown fields, mixed time units, duplicate keys, non-series
endpoints, ranges outside the owned view, and ranges larger than 1,024 market observations are
rejected.

The daemon recomputes a `loom.selection.v0` record from canonical blobs and durably publishes it in
an exact `loom.selection-created.v0` payload. Its `visibleSummary` metrics use
`sampleScope: "selection"`; ordinary backtest metrics remain `full-sample`. The record is bound to
project, session, and view and carries no raw series values. A successful command receipt includes
the selection ID.

To ground a later prompt, `loom.message.send.v0` may include that selection ID. The daemon resolves
it from the owned durable log and supplies Pi with only the portable view reference, range, and
daemon-derived summary. An unknown or cross-session ID returns `SELECTION_NOT_FOUND`.

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
POST /v0/sessions/:sessionId/selections?projectId=:projectId
POST /v0/sessions/:sessionId/promotions?projectId=:projectId
POST /v0/sessions/:sessionId/tasks/:taskId/cancel?projectId=:projectId
```

The corresponding body formats are `loom.session.create.v0`, `loom.message.send.v0`,
`loom.selection.create.v0`, `loom.promotion.create.v0`, and `loom.task.cancel.v0`. Unknown fields,
blank messages, oversized bodies, non-portable IDs, and unavailable profiles fail closed. Ordinary
commands use `loom.command.accepted.v0`; promotion uses `loom.promotion.accepted.v0` so the source and
new target session are explicit. Message and cancellation responses carry a task ID, while selection
creation carries a selection ID. Completion never depends on the HTTP connection: it is reported by
the ordered event stream.

The Raw Pi adapter maps public text deltas, assistant completion, and coarse tool/task state. It does
not expose model thinking, tool arguments, tool result bodies, or provider diagnostics. The
`loom.pi-runtime.v0` descriptor records package version, provider, model, mode, and a non-secret
fingerprint so a replay remains attributable.

## Assurance

Loom may issue only `exploratory` assurance. Contract and Experiment states must be independently
derived from validated Veil records. For the v0 complete promotion recipe, Loom publishes a final
state only after Veil reloads and verifies the immutable Experiment archive. The browser never
infers assurance from a metric, process exit code, model message, visual similarity, loaded Veil
extension, or `ready` project response.
