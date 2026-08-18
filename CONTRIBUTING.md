# Contributing

[简体中文](CONTRIBUTING.zh-CN.md)

Veil Loom is in pre-alpha development. Small changes that preserve the process and assurance
boundaries are welcome.

## Setup

Use Node 22.19 or newer.

```bash
npm install
npm run check
```

Use `npm run lint:fix` for mechanical formatting. Keep public code, schemas, errors, issues, and pull
requests in English. Chinese belongs only in the paired `.zh-CN.md` documentation. When public
documentation changes, update both language versions in the same pull request and keep commands,
protocol fields, and security boundaries semantically aligned. The English file remains the
canonical default.

## Boundaries

- The web app must not import Pi, Veil, filesystem, or process APIs.
- The daemon owns local authority and publishes only redacted, validated protocol events.
- New daemon routes are authenticated by default and need wrong-Origin and missing-cookie tests.
- Raw Pi output is always exploratory.
- Accepted, degraded, and rejected assurance can only be derived from verified Veil evidence.
- Adding a backtest adapter requires a deterministic fixture and failure tests.
- Browser-supplied selection metrics are untrusted; summaries must be derived from owned daemon
  resources and remain bounded.
- Pi SDK upgrades must keep `npm audit` clean and preserve the public event redaction tests.

Before opening a pull request, describe which boundary the change touches and whether documentation
or protocol compatibility changed.
