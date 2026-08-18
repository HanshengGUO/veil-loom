# Veil Loom

[简体中文](README.zh-CN.md)

Veil Loom is a local-first visual workspace for quantitative research with
[Pi](https://github.com/earendil-works/pi) and [Veil](https://github.com/HanshengGUO/veil).

It is designed around one simple boundary: exploration should stay fast, while claims should remain
honest. Raw Pi sessions can chat, code, run local tools, and publish interactive research views.
Veil sessions add guarded data, promotion contracts, statistical gates, Experiment memory, and
reproduction.

> Status: pre-alpha with restart-resilient Raw Pi and Veil sessions, synchronized backtest charts,
> bounded chart selections, project-level Veil readiness, and independent Raw-to-Veil verification
> attempts with reviewable evidence and exact reproduction. The model path remains fully offline,
> and Loom itself is not published to npm.

## Session profiles

| Profile | What it adds | Assurance |
| --- | --- | --- |
| Raw Pi | Pi plus Loom conversation and visualization tools | Every result is exploratory and unverified |
| Veil | Raw Pi capabilities plus `veil-quant` | Veil may issue contract or Experiment evidence after independent re-execution |

A Raw Pi result cannot be upgraded by changing a badge. **Promote with Veil** creates a separate
Veil session and ledger, rereads registered data, and re-executes the selected artifact. The source
view stays exploratory regardless of the new attempt's outcome.

The daemon currently pins `veil-quant` to the tested `0.1.x` line, loads its public project API, and
reports whether the current project is ready. A ready profile means the Veil tools can be loaded; it
does not mean that any result has been verified. Loom projects the new attempt's coarse lifecycle,
archive-validated Experiment identity, bounded evidence summary, and exact reproduction result.

## Architecture

```text
Browser (Next.js + Tailwind)
  │ HTTP commands + SSE events
  ▼
Loom daemon (Node.js)
  ├── Pi host + Loom extension
  ├── optional veil-quant extension
  ├── project/session/task store
  └── view and evidence projection
          ▼
      user tools + Veil public APIs
```

The browser never owns local process, filesystem, provider credential, or evidence authority. The
daemon binds to loopback by default. Pi's ordinary shell runs with the user's permissions; Loom and
Veil do not describe it as a sandbox.

## Repository layout

```text
apps/web/          Next.js App Router and Tailwind UI
apps/daemon/       local Node service and process supervisor
packages/protocol/ shared versioned schemas
docs/              public architecture, protocol, and security notes
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Research workflow](docs/research-workflow.md)
- [Core concepts](docs/core-concepts.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Security model](docs/security.md)
- [Clean-machine acceptance](docs/clean-machine-acceptance.md)
- [Contributing a backtest adapter](docs/contributing-adapters.md)
- [Contribution guide](CONTRIBUTING.md), [security reporting](SECURITY.md), and
  [changelog](CHANGELOG.md)

English is the default documentation language. Every document links to its complete Simplified
Chinese counterpart directly below the title.

## Development

Requires Node 22.19 or newer.

```bash
npm install
npm run check
```

Run the built-product acceptance before a release or platform-sensitive change:

```bash
npm run accept:clean-machine
```

It builds the repository, starts the production Web app and daemon on free loopback ports, copies
the daily-factor fixture into a temporary project, and exercises chart import, selection, Veil
promotion, daemon restart, evidence review, and exact reproduction. The runner uses Pi's offline
faux provider, passes no provider credentials to child services, and removes its temporary project
and state. CI runs the same built-product path on Linux, macOS, and Windows with Node 24; Linux also
keeps the minimum Node 22 full-check lane. See
[Clean-machine acceptance](docs/clean-machine-acceptance.md) for the frozen contract.

Run the two development processes in separate terminals:

```bash
npm run dev:daemon
npm run dev:web
```

Both processes bind to loopback. In development, the daemon runs a scripted request through Pi's
real programmatic session and Loom extension using Pi's offline faux provider. The extension invokes
one explicit adapter for the committed daily-factor output. Loom validates it, atomically stores
content-addressed series, and publishes only bounded view metadata to the durable event stream.

Open the web app at its exact loopback address, `http://127.0.0.1:3000`. It performs an Origin-gated
bootstrap and receives an HttpOnly daemon-session cookie; no token needs to be copied into the UI or
placed in a URL. The daemon listens at `http://127.0.0.1:43120` by default.

The Web app loads the owned view resources and renders actual OHLC bars, execution markers, net
equity, drawdown, metrics, and provenance. Both charts share one crosshair, time range, zoom, pan,
and selection. Drag a range or choose the maximum-drawdown window, create a bounded selection
context, then ask Pi about it. The browser sends only the view ID, time range, and visible series
keys; the daemon validates ownership and recomputes the summary from canonical resources.

Restarting the daemon preserves completed work and restores usable Raw Pi and Veil sessions before
it begins serving commands. A task that was still running is recorded as interrupted and must be
retried; Loom never turns an incomplete task into a successful result during recovery.

The development project also contains a small `.veil/project.yaml`. The daemon resolves its root,
loads it through the published Veil API, and shows only a path-free readiness summary in the Web
app. Project paths, dataset identifiers, environment values, and source locators stay in the daemon.
Veil sessions use the same restart rules as Raw Pi sessions and remain
**EXPLORATORY · UNVERIFIED** until independent evidence exists.

The Web shell now exposes **Promote with Veil** for the committed Raw view. Its request contains only
the owned view ID, a project-relative artifact reference, and the hypothesis. The daemon verifies
the artifact digest, creates a new Veil session, records chronology, reads the registered panel
through `veil-data`, and runs the complete contract, pricing, gate, and Experiment path. Raw equity,
Sharpe, and other displayed metrics are not copied into the request or used as expected results.

This is still one deterministic adapter fixture, not a general backtest engine, and it does not
contact a model service. The Raw view remains **EXPLORATORY · UNVERIFIED**. Any accepted, degraded,
or rejected assurance belongs only to the independently executed Veil attempt; an execution failure
produces no Experiment label at all.

Completed Experiments appear in a bounded project index, so refreshing the Web app can reopen the
latest attempt without replaying a model conversation. The evidence drawer shows the verified
dataset and method identities, OOS metrics, cost model, gate outcomes, limitations, and content
hashes. It never sends artifact code, raw pricing payloads, snapshot contents, or local paths to the
browser. **Reproduce Experiment** reruns the archived artifact, pricing, and gates from immutable
snapshots. A matched reproduction confirms identity parity; it does not change the original
accepted, degraded, or rejected verdict.

## Initial milestone

The first vertical slice is taking one deterministic daily-factor example end to end:

1. open a local project;
2. create a Raw Pi or Veil session;
3. render market, equity, drawdown, trades, and explicit assurance — implemented for the reference
   adapter;
4. send a selected chart range back to Pi — implemented for the live offline fixture;
5. create a fresh Veil verification attempt — implemented with a minimal portable handoff;
6. inspect the Experiment and reproduce it — implemented with bounded evidence and matched-identity
   replay.

L2/L3 data, automatic framework detection, autonomous cruise mode, and multi-agent pattern scanning
are deliberately outside this milestone.

## License

MIT.
