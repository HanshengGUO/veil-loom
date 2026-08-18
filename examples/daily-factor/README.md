# Daily factor example

This directory is the deterministic reference input for Loom's first backtest adapter:

- [`market.csv`](./market.csv) is a small public daily OHLCV sample;
- [`factor.ts`](./factor.ts) defines the illustrative two-session momentum signal;
- [`artifact/daily-factor.mjs`](./artifact/daily-factor.mjs) exposes the same rule through Veil's
  framed `compute(table, context)` artifact runtime contract;
- [`reference-import.json`](./reference-import.json) is the normalized
  `loom.backtest-import.v0` output with next-session-open execution, net equity, 10 bps round-trip
  cost, trades, metrics, and provenance.
- [`.veil/project.yaml`](./.veil/project.yaml) registers the small Veil project used by the
  readiness check;
- [`adapter.yaml`](./adapter.yaml) and [`veil-prices.csv`](./veil-prices.csv) form its public,
  35-session, four-entity point-in-time verification fixture.

The daemon does not discover these files by name or execute the factor in the browser. Its explicit
reference adapter imports the committed normalized record, validates it, stores immutable resources,
and publishes an exploratory view.

For the demo ownership tuple `daily-factor-demo / raw-pi-demo / demo-task-1`, the expected view ID is
`view_77ff60190d8f20b3c5732d295c319dac6915f326ffb01653de963c6502c2c1d1`. Tests also freeze all four
blob identities and verify the source/artifact digests against the committed bytes.

Loading the Veil declaration proves only that the profile is ready. The scripted Pi response still
does not auto-promote anything. The separate Web action verifies the selected artifact digest,
creates a new Veil session, rereads this registered panel, and may issue an Experiment after the
complete contract/pricing/gate path. It never imports the Raw chart metrics as targets. This fixture
is illustrative and not investment advice. The evidence drawer shows the verified OOS metrics and
gate reasons, and its reproduction action replays the archived artifact from immutable snapshots;
neither operation changes the Raw view or the Experiment's original verdict.
