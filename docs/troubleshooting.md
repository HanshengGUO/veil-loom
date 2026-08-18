# Troubleshooting

[简体中文](troubleshooting.zh-CN.md)

This guide covers the committed developer-preview workflow. It does not recommend weakening Origin,
cookie, path, or evidence checks to make an error disappear.

## Installation fails

Confirm the runtime first:

```bash
node --version
npm --version
```

Veil Loom requires Node 22.19 or newer. Install from the public npm registry and keep the committed
lockfile intact:

```bash
npm ci --registry=https://registry.npmjs.org
```

If an error names an unexpected registry mirror, inspect your user or machine npm configuration.
Do not edit package-lock URLs or commit a private registry workaround to the repository.

## A port is already in use

The development Web app uses `127.0.0.1:3000`; the daemon uses `127.0.0.1:43120`. Stop the process
already using that port, then restart the affected command. The current developer preview assumes
these paired defaults, so changing only one side will break the configured Origin or daemon URL.

## The page opens but says “Connecting daemon”

Check that `npm run dev:daemon` is still running and printed:

```text
Veil Loom daemon listening on http://127.0.0.1:43120 with the offline Pi fixture
```

Open `http://127.0.0.1:3000`, not `http://localhost:3000`. The exact Origin is part of the daemon
security check. A browser extension or proxy that rewrites the Origin can also cause rejection.

After a daemon restart, the old HttpOnly cookie is intentionally invalid. The Web client normally
bootstraps again automatically. If the browser was asleep or kept a stale failed connection,
refresh the exact loopback page once.

## Veil readiness is invalid or unavailable

Readiness failures do not mean a research claim was rejected. They mean the Veil capability or
project could not load.

For the committed demo, verify that:

- both commands were started from the repository root;
- `npm ci` completed without omitting workspace dependencies;
- `examples/daily-factor/.veil/project.yaml` still exists;
- the installed `veil-quant` remains on the tested `0.1.x` line;
- the daemon was restarted after dependency or project changes.

The public message deliberately omits private paths. Use the daemon's trusted local diagnostics for
development details; do not add raw filesystem errors to browser responses.

## The chart never appears

The Raw demo task must complete before the browser can load an owned view. Check the left pane for a
failed or interrupted task and the daemon terminal for a startup failure.

To distinguish stale state from a current code problem, start the daemon with a new empty state
directory instead of deleting the old one:

```bash
LOOM_STATE_DIR=/tmp/veil-loom-fresh-state npm run dev:daemon
```

On Windows PowerShell:

```powershell
$env:LOOM_STATE_DIR = "$env:TEMP\veil-loom-fresh-state"
npm run dev:daemon
```

If the clean state works, preserve the original directory for diagnosis. A corrupt durable log is
supposed to fail closed rather than silently discard events.

## Selection buttons are disabled

**Create selection context** requires a loaded view and a non-empty range. Drag either chart or use
the maximum-drawdown shortcut first.

**Ask Pi about selection** requires a successfully created selection. If creation fails, clear the
range and select aligned chart observations. The daemon rejects ranges outside the view, mixed time
units, unavailable series, cross-session ownership, and ranges over 1,024 market points.

## “Promote with Veil” is disabled

All of the following must be true:

- the source session is Raw Pi and ready;
- an owned view has been durably published;
- project readiness is `ready`;
- artifact reference and hypothesis are non-empty;
- no current promotion attempt is open.

The default reference is `artifact/daily-factor.mjs`. It is relative to the registered project,
not the repository process or browser. If a completed attempt is open after refresh, use **New
attempt** before starting another.

## Promotion says execution failed

Execution failure is intentionally different from a `rejected` Experiment. It means the child
artifact/runtime did not produce a successful verifiable result, so Loom issues no verdict. Inspect
trusted daemon diagnostics and the artifact locally. Do not reinterpret the failure as rejection or
copy Raw metrics into the request as expected values.

## A task became interrupted after restart

This is expected when `task.started` was durable but no terminal event existed before shutdown.
Loom records `task.interrupted` with `DAEMON_RESTART`; it does not guess from Pi history or output
files. Retry the action. Completed tasks and their event prefixes should remain intact.

## Reproduction does not say matched

Matched reproduction requires the archived Experiment, captured artifact, immutable snapshots,
pricing, metrics, and gate identities to agree. Failure, cancellation, retention deletion, and
restart produce no match. None of those outcomes is allowed to change the original verdict.

## The full check is slow on Windows

Windows starts real child processes during integration tests and the built-product acceptance, so it
is normally slower than Linux or macOS. Run the targeted check while developing, then use one full
gate before handoff:

```bash
npm run check
npm run accept:clean-machine:built
```

Use `accept:clean-machine:built` only after a successful build. `accept:clean-machine` is the
standalone command that builds first.

## Before reporting a bug

Include the operating system, Node/npm versions, command, public error code, and whether a fresh
state directory reproduces the problem. Remove provider keys, cookies, local paths, raw market data,
private daemon diagnostics, and archive contents before posting publicly. Security findings belong
in GitHub private vulnerability reporting as described in [Security](../SECURITY.md).
