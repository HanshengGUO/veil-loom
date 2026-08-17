# Veil Loom

Veil Loom is a local-first visual workspace for quantitative research with
[Pi](https://github.com/badlogic/pi-mono) and [Veil](https://github.com/HanshengGUO/veil).

It is designed around one simple boundary: exploration should stay fast, while claims should remain
honest. Raw Pi sessions can chat, code, run local tools, and publish interactive research views.
Veil sessions add guarded data, promotion contracts, statistical gates, Experiment memory, and
reproduction.

> Status: pre-alpha repository scaffold. Nothing is published to npm yet.

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

Requires Node 20.10 or newer.

```bash
npm install
npm run check
```

Run the two development processes in separate terminals:

```bash
npm run dev:daemon
npm run dev:web
```

The initial daemon listens on `127.0.0.1:43120`; the web app uses Next.js's normal development
address. The current page is a boundary-first product shell, not a functional Pi integration.

## Initial milestone

The first vertical slice will run one deterministic daily-factor example end to end:

1. open a local project;
2. create a Raw Pi or Veil session;
3. render market, equity, drawdown, trades, and explicit assurance;
4. send a selected chart range back to Pi;
5. create a fresh Veil verification attempt;
6. inspect the Experiment and reproduce it.

L2/L3 data, automatic framework detection, autonomous cruise mode, and multi-agent pattern scanning
are deliberately outside this milestone.

## License

MIT.
