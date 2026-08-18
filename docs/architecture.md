# Architecture

Veil Loom is split into a browser application, a local daemon, and a dependency-free protocol
package.

```text
Next.js browser app
  │ validated HTTP commands and ordered SSE events
  ▼
Node daemon
  ├── Pi host
  │   ├── Loom extension
  │   └── optional veil-quant extension
  ├── durable session/task events
  ├── local project capabilities
  └── chart and evidence projection
```

The split is a security boundary, not a deployment preference. Local files, subprocesses, model
credentials, and Veil evidence remain in the daemon. The browser renders projections and submits
bounded commands.

## Local transport

The Web app and daemon bind to fixed loopback addresses. Before opening protected routes, the
browser sends an empty bootstrap POST from the configured exact Origin. The daemon returns a
process-scoped secret only as an HttpOnly, SameSite session cookie and acknowledges the handshake
with non-secret JSON. EventSource then connects directly to the daemon with credentials enabled.

This avoids putting bearer material in JavaScript, local storage, query parameters, browser history,
Referer headers, or Next.js proxy configuration. A daemon restart rotates the secret; reconnecting
clients bootstrap again before resuming from their durable cursor.

## Profiles

Raw Pi and Veil are profiles over one Pi host rather than unrelated backends. A session freezes its
profile when it starts. A Raw Pi to Veil transition creates a new verification attempt because Veil
must register chronology and independently re-execute the artifact.

The daemon registers project roots at startup; the browser supplies only a portable project ID. Raw
Pi receives the canonical registered root. Before a Veil session starts, the daemon also loads the
project through the published `veil-quant` API and validates the supported public shape. Missing
packages, unsupported versions, unreadable roots, and invalid project declarations fail before a
session event is written.

`veil-quant` currently publishes TypeScript source, so the daemon uses its declared `tsx` runtime to
load that public entry point. Loom pins the tested `>=0.1.0 <0.2.0` range, checks the expected tool
and project formats, and does not import Veil engine internals. The loaded extension adds Veil's
data, backtest, and memory tools to a Veil Pi session. Ordinary Pi views remain exploratory. Only a
separate promotion task may project a non-exploratory state, and only after Loom reloads and verifies
the Experiment archive through Veil's public API.

### Project readiness

Readiness has three public states:

- `ready`: the tested Veil runtime and project declaration loaded successfully;
- `invalid`: the runtime loaded, but the project did not;
- `unavailable`: the runtime or daemon-authorized project root is unavailable.

The response contains the installed and supported versions, detected project format, capabilities,
and aggregate counts for datasets, runtimes, cost models, and null generators. It never contains the
project root, source locator, dataset ID, or environment name. The Web app validates the exact
response and enables the Veil profile only for `ready` projects. Readiness is capability discovery,
not evidence or assurance.

## Long-running work

Next.js request handlers and Server Actions do not own research tasks. The daemon accepts a command,
persists task state, and reports progress or a terminal result through the event stream. Browser
disconnects do not cancel tasks.

## Verification attempts

The v0 promotion boundary is deliberately narrow. The browser submits an owned Raw view ID, one
normalized project-relative artifact reference, and a bounded hypothesis. It cannot submit Raw
metrics, an expected result, a data path, a promotion request file, gate settings, or an assurance
label.

Before creating anything, the daemon checks that the source session is Raw Pi, the view was durably
published by a completed task, the explicit daily-factor adapter owns it, the project is Veil-ready,
and the selected file hashes to the view's artifact digest. It then creates a new Veil session. The
old event log is not amended.

The target Pi session's private append-only branch is the Veil ledger. Loom records the hypothesis,
rereads the registered panel through `veil-data`, and writes a daemon-owned promotion request that
contains the new read-set ID and fixed adapter recipe. Veil performs artifact capture, walk-forward
execution, pricing, costs, statistical gates, and Experiment persistence. Loom calls
`loadProjectExperiment()` on the resulting identity and checks every projected hash again before it
appends `veil.experiment_recorded`.

The public stream stays coarse because Veil's current public backtest call is atomic. It reports a
completed development-data read, independent verification running/completed, and the final
Experiment identity. The panel read is exploration-grade chronology context, not verification
evidence; the independent run performs the point-in-time guarded reads. Loom does not invent
per-fold or per-gate progress. `ok: false`, an exception, cancellation, or a daemon restart yields a
failed, cancelled, or interrupted task with no rejected Experiment inference. Accepted, degraded,
and rejected are reserved for an actual verified archive.

## Experiment review and reproduction

The project Experiment index is a bounded identity index over durable Veil session events. It lets
the Web app reopen the latest completed attempt after refresh, but it is not a substitute for
archive verification. Opening an item calls `loadProjectExperiment()` again and checks its session,
attempt, hypothesis, verdict, assurance, and structural hashes before returning
`loom.experiment-evidence.v0`.

That response is a review projection, capped at 128 KiB. It contains verified method, dataset, cost,
sample, metric, gate, limitation, and lineage identities. Artifact source, Arrow bytes, pricing
payloads, snapshot contents, archive paths, and private diagnostics remain in the daemon. Long lesson
lists carry an explicit total and truncation flag.

Reproduction is a new cancellable task on the owning Veil session. The daemon calls Veil's public
`reproduceProjectExperiment()` with the Experiment ID and project runtime; Veil reloads the archive,
materializes the captured artifact, replays immutable read-set snapshots, and recomputes pricing and
gates. Loom emits `veil.reproduction_completed` only for an exact `matched` result whose Experiment,
pricing, gate-evaluation, metric, and reproduction hashes validate. Failure, cancellation, or restart
produces no matched record. A match confirms reproducibility and never changes the original verdict.

## Pi host

The daemon embeds Pi through its public programmatic `AgentSession` API. A runtime adapter owns each
session, subscribes to Pi events, and turns only user-visible text and coarse tool/task lifecycle
into Loom events. It does not publish thinking blocks, tool arguments, tool result bodies, provider
errors, environment values, or local paths. Every session records the Pi package version and a
provider/model fingerprint without recording credentials.

The current slice enables only a deterministic offline provider, one reference-backtest Loom tool,
and the version-pinned Veil extension for ready projects. The scripted response invokes only the
committed reference adapter; promotion is a separate explicit browser action. The Loom reference
tool has no shell, filesystem, or network authority. Veil tools retain the local authority
documented by Veil. Real provider configuration and local coding tools remain opt-in work; they will
stay in the daemon rather than moving into the browser.

## Research views

The reference adapter accepts one exact `loom.backtest-import.v0` record. It validates ordered time,
uniform units, finite OHLCV/equity/drawdown values, trades, metric methods, execution semantics, and
source identities before writing anything. A successful import produces four small JSON resources
and one `loom.backtest-view.v0` record. Resource IDs are SHA-256 identities over canonical JSON.

Resources are immutable. Blobs are stored by content identity; views are bound to project, session,
task, adapter, source, artifact, and run provenance. The daemon writes and syncs temporary files,
then atomically links them into place before appending `view.published`. A failed event append may
leave an unreferenced immutable object, but it cannot expose a partial view.

The event log contains only `loom.view-published.v0` metadata. The browser uses that durable
descriptor to request the view and each referenced blob, checks their schemas and ownership again,
and renders the chart projection. Linked interaction remains separate from this storage boundary.

## Synchronized selection

Market, equity, and drawdown charts consume one browser-side viewport state. It owns the visible
range, crosshair, selected range, series resolution, and the origin of each zoom or pan. Origin IDs
are remembered for a bounded window so a chart cannot feed a reflected update back into the
controller and create an interaction loop.

A browser selection is only a request over an owned view: view ID, exact range endpoints, and the
visible series keys. The daemon reloads the canonical resources, verifies the time unit, domain,
endpoint alignment, ownership, requested series, and 1,024-point limit, then derives market return,
net return, maximum drawdown, and execution count as applicable. It appends the exact
`selection.created` event before acknowledging the command.

Pi receives a portable view reference, selected range, and the daemon-derived metrics. It does not
receive the underlying series through this path. The public user event keeps the original question
and selection ID; raw chart data and hidden model context do not enter the event log.

## Event recovery

Each session has an append-only JSONL event log with its own contiguous sequence. The daemon syncs a
new record to disk before making it visible to an SSE subscriber. On restart it validates the full
log and rebuilds the in-memory tail; partial or reordered records fail closed instead of being
silently dropped.

Before accepting commands, the daemon discovers every portable project/session log and reconciles
its last durable state. The Loom event log is authoritative for public lifecycle and task outcome.
If a task has `task.started` but no durable terminal event, recovery first appends
`session.status_changed: recovering`, then `task.interrupted`, and only then attempts to reopen the
runtime. It never infers completion from model history, files, or a provider response. Sessions that
never reached `session.ready`, have a corrupt topology, or cannot restore the recorded runtime stay
unavailable with a durable failed state.

Pi keeps a separate private session file for conversation continuity. Loom binds it to a hashed
project/session identity with an ownership marker and reopens it only when the package, provider,
model, mode, and fingerprint still match the public runtime descriptor. The recovered runtime is
registered only after a new durable ready status. This second file can restore model context, but it
cannot create, amend, or upgrade a Loom task result.

Sessions created before Pi persistence existed have a narrow compatibility path: Loom creates a new
Pi session from at most 32 recent public user messages and assistant completions, bounded to 32 KiB,
and labels the recovery as `reconstructed`. Deltas, thinking, tool arguments, tool results, raw
series, and private diagnostics are not copied. The context explicitly warns that omitted or
interrupted work did not succeed.

The browser reconnects with the last sequence it applied. Subscription and replay are registered as
one serialized operation, so an event cannot fall between the replay snapshot and the live stream.

The browser reducer independently checks the protocol envelope, project/session ownership, SSE ID,
sequence, event identity, and duplicate content. An exact duplicate is harmless. A gap closes the
stream and starts a new explicit replay from the last applied sequence; a conflicting duplicate or
malformed event fails closed and remains visible as a connection error.

State lives in the normal per-user application-state directory:

- Linux: `$XDG_STATE_HOME/veil-loom`, or `~/.local/state/veil-loom`;
- macOS: `~/Library/Application Support/Veil Loom`;
- Windows: `%LOCALAPPDATA%\\Veil Loom`.

`LOOM_STATE_DIR` provides an explicit override for development and packaging.

## Development fixture

`npm run dev:daemon` runs one scripted request through a real Pi session and Pi's offline faux
provider, then imports the committed daily-factor reference output. The resulting event projection
and content-addressed view are durable, are validated on restart, and refuse conflicting identities.
The demo root includes a valid Veil project declaration, so the Web app also renders a path-free
readiness summary. The explicit promotion action uses a committed Veil-compatible momentum artifact
and a 35-session, four-entity point-in-time panel; it never treats the Raw chart metrics as a target.
`npm run dev:web` authenticates directly to the loopback daemon and renders the real fixture series.
Production builds do not enable the demo stream.

## Dependency direction

`apps/web` depends only on the protocol package. `apps/daemon` depends on the protocol and may depend
on Pi and published Veil packages. Veil never depends on Loom.
