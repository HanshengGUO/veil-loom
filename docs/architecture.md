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
profile when it starts. Moving from Raw Pi to Veil creates a new verification attempt because Veil
must register chronology and independently re-execute the artifact.

## Long-running work

Next.js request handlers and Server Actions do not own research tasks. The daemon accepts a command,
persists task state, and reports progress or a terminal result through the event stream. Browser
disconnects do not cancel tasks.

## Pi host

The daemon embeds Pi through its public programmatic `AgentSession` API. A runtime adapter owns each
session, subscribes to Pi events, and turns only user-visible text and coarse tool/task lifecycle
into Loom events. It does not publish thinking blocks, tool arguments, tool result bodies, provider
errors, environment values, or local paths. Every session records the Pi package version and a
provider/model fingerprint without recording credentials.

The current slice enables only a deterministic offline provider and one reference-backtest Loom
tool. The tool can invoke the committed adapter but has no shell, filesystem, or network authority.
Real provider configuration and local coding tools remain opt-in work; they will stay in the daemon
rather than moving into the browser.

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
`npm run dev:web` authenticates directly to the loopback daemon and renders the real fixture series.
Production builds do not enable the demo stream.

## Dependency direction

`apps/web` depends only on the protocol package. `apps/daemon` depends on the protocol and may depend
on Pi and published Veil packages. Veil never depends on Loom.
