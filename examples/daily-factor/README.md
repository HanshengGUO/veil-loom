# Daily factor example

This directory is the deterministic reference input for Loom's first backtest adapter:

- [`market.csv`](./market.csv) is a small public daily OHLCV sample;
- [`factor.ts`](./factor.ts) defines the illustrative two-session momentum signal;
- [`reference-import.json`](./reference-import.json) is the normalized
  `loom.backtest-import.v0` output with next-session-open execution, net equity, 10 bps round-trip
  cost, trades, metrics, and provenance.

The daemon does not discover these files by name or execute the factor in the browser. Its explicit
reference adapter imports the committed normalized record, validates it, stores immutable resources,
and publishes an exploratory view.

For the demo ownership tuple `daily-factor-demo / raw-pi-demo / demo-task-1`, the expected view ID is
`view_74836c889d6cddf9bef2578ae4b86797662fef1f4bc4f203898b745ed2e27088`. Tests also freeze all four
blob identities and verify the source/artifact digests against the committed bytes.

This fixture is illustrative, not investment advice or Veil evidence. Chart selection, promotion,
and reproduction consume the same identities in later slices.
