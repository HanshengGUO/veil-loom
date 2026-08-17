# Contributing a backtest adapter

The adapter API is not frozen yet. The first implementation will support one committed daily-factor
fixture before accepting framework-specific adapters.

An adapter will be required to provide deterministic fixtures for market data, trades, net equity,
drawdown, metric units and methods, and provenance. Successful import creates an exploratory view;
it never creates Veil assurance.

Do not build an adapter against inferred file names or the current scaffold. This page will contain
the versioned import schema once the reference adapter passes its vertical-slice acceptance.
