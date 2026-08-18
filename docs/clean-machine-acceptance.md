# Clean-machine acceptance

Veil Loom has one release-facing acceptance path for its reference workflow. It is intentionally
separate from unit tests: the runner starts the production build and talks only through public HTTP
routes.

Run it from the repository root on Node 22.19 or newer:

```bash
npm ci
npm run accept:clean-machine
```

`accept:clean-machine` builds all workspaces before starting the runner. CI has already built during
`npm run check`, so its matrix uses `npm run accept:clean-machine:built` to avoid a duplicate build.

## What it proves

The runner allocates free loopback ports, starts the built Next.js app, and confirms that its product
shell is reachable. It then starts the built daemon against a temporary copy of the committed
daily-factor project and performs this sequence:

1. bootstrap an Origin-bound daemon session and confirm Veil project readiness;
2. create a Raw Pi session through Pi's offline faux provider;
3. publish the reference backtest view and load its market, equity, drawdown, and trade resources;
4. create a full-range selection from canonical resources and send the selection back to Pi;
5. promote the owned Raw view into a separate Veil session and wait for a real Experiment;
6. restart the daemon, reject the old browser cookie, and recover both durable sessions;
7. reopen project history and archive-validated Experiment evidence;
8. use the pre-restart selection in a new Raw task;
9. reproduce the Experiment and require exact Experiment, pricing, gate, and verdict parity.

It also checks that promotion did not mutate the Raw event log, restart preserved the old event
prefix, reproduction did not change the archived verdict, public evidence contains no private path
or archive payload, and every committed fixture input retained its SHA-256 digest.

## Matrix and boundaries

The GitHub Actions matrix runs the built-product acceptance on current Node 24 for Ubuntu, macOS,
and Windows. A separate Ubuntu Node 22 lane runs the full lint, typecheck, test, and build gate at the
declared minimum Node line without repeating the vertical smoke.

The runner uses no shell utilities, browser automation, provider network, or external credentials.
Child services receive a small environment allowlist, and the copied project/state are removed on
success or failure. This verifies the committed reference adapter and local process boundary. It
does not certify arbitrary user tools, third-party adapters, real model providers, desktop
packaging, or remote access.
