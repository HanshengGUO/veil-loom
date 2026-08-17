# Veil Loom

Veil Loom is a local-first visual workspace for quantitative research with
[Pi](https://github.com/earendil-works/pi) and [Veil](https://github.com/HanshengGUO/veil).

It is designed around one simple boundary: exploration should stay fast, while claims should remain
honest. Raw Pi sessions can chat, code, run local tools, and publish interactive research views.
Veil sessions add guarded data, promotion contracts, statistical gates, Experiment memory, and
reproduction.

> Status: pre-alpha with durable replay, a real Pi host, synchronized backtest charts, and bounded
> chart selections that can be sent back to Pi. The model path remains fully offline, and nothing
> is published to npm.

## Session profiles

| Profile | What it adds | Assurance |
| --- | --- | --- |
| Raw Pi | Pi plus Loom conversation and visualization tools | Every result is exploratory and unverified |
| Veil | Raw Pi capabilities plus `veil-quant` | Veil may issue contract or Experiment evidence after independent re-execution |

A Raw Pi result cannot be upgraded by changing a badge. **Promote with Veil** creates a new
verification attempt and re-executes the locked artifact through Veil.

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

## Development

Requires Node 22.19 or newer.

```bash
npm install
npm run check
```

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

This is a deterministic import fixture, not a general backtest engine, and it does not contact a
model service. Every result remains **EXPLORATORY · UNVERIFIED**.

## Initial milestone

The first vertical slice is taking one deterministic daily-factor example end to end:

1. open a local project;
2. create a Raw Pi or Veil session;
3. render market, equity, drawdown, trades, and explicit assurance — implemented for the reference
   adapter;
4. send a selected chart range back to Pi — implemented for the live offline fixture;
5. create a fresh Veil verification attempt;
6. inspect the Experiment and reproduce it.

L2/L3 data, automatic framework detection, autonomous cruise mode, and multi-agent pattern scanning
are deliberately outside this milestone.

## License

MIT.
