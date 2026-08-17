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

## Profiles

Raw Pi and Veil are profiles over one Pi host rather than unrelated backends. A session freezes its
profile when it starts. Moving from Raw Pi to Veil creates a new verification attempt because Veil
must register chronology and independently re-execute the artifact.

## Long-running work

Next.js request handlers and Server Actions do not own research tasks. The daemon accepts a command,
persists task state, and reports progress or a terminal result through the event stream. Browser
disconnects do not cancel tasks.

## Event recovery

Each session has an append-only JSONL event log with its own contiguous sequence. The daemon syncs a
new record to disk before making it visible to an SSE subscriber. On restart it validates the full
log and rebuilds the in-memory tail; partial or reordered records fail closed instead of being
silently dropped.

The browser reconnects with the last sequence it applied. Subscription and replay are registered as
one serialized operation, so an event cannot fall between the replay snapshot and the live stream.

State lives in the normal per-user application-state directory:

- Linux: `$XDG_STATE_HOME/veil-loom`, or `~/.local/state/veil-loom`;
- macOS: `~/Library/Application Support/Veil Loom`;
- Windows: `%LOCALAPPDATA%\\Veil Loom`.

`LOOM_STATE_DIR` provides an explicit override for development and packaging.

## Dependency direction

`apps/web` depends only on the protocol package. `apps/daemon` depends on the protocol and may depend
on Pi and published Veil packages. Veil never depends on Loom.
