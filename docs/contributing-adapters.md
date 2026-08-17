# Contributing a backtest adapter

The first adapter boundary is now implemented for one committed daily-factor fixture. It is narrow
on purpose: framework-specific discovery remains out of scope until this contract has real user
feedback.

An adapter normalizes its output into `loom.backtest-import.v0`. The record includes ordered OHLCV,
net equity, drawdown, normalized executions, metrics with unit/scale/scope/method, source and artifact
digests, and explicit execution/cost semantics. Successful import creates an exploratory
`loom.backtest-view.v0`; it never creates Veil assurance.

The validator rejects unknown fields, non-finite values, duplicate or descending timestamps, mixed
time units, invalid OHLC ranges, misaligned equity/drawdown, out-of-range trades and regions,
duplicate metric keys, schema drift, and oversized JSON resources. Output is validated in full
before content-addressed resources are atomically published.

Use [`examples/daily-factor/reference-import.json`](../examples/daily-factor/reference-import.json)
as the executable contract fixture. Its source data and factor artifact are committed beside it,
and tests verify both SHA-256 digests and the expected view/blob identities. Do not infer “the latest
result” from a filename, parse arbitrary Pi tool output, bypass the validator, or label an imported
view as verified.
