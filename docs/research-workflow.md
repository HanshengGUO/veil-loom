# Research workflow

[简体中文](research-workflow.zh-CN.md)

This walkthrough uses the repository's deterministic daily-factor project. It shows the product
boundary end to end without a model account or private market data. Complete
[getting started](getting-started.md) first and keep both development processes running.

## 1. Confirm the local boundary

Open `http://127.0.0.1:3000` and check the header before interpreting any result:

- **Daemon live** means the authenticated event stream is connected;
- **Offline Pi fixture** means no model provider is being contacted;
- **Veil 0.1.0 ready** means the registered demo project can start a Veil attempt;
- **EXPLORATORY · UNVERIFIED** means the source chart has no independent assurance.

If readiness is unavailable or the stream is not live, stop here and use
[troubleshooting](troubleshooting.md). A chart on screen is not enough to prove the local authority
behind it is healthy.

## 2. Read the Raw research view

The demo daemon creates an idempotent Raw Pi session and asks the reference tool to publish the
committed backtest. The left pane shows the visible Pi conversation and task lifecycle. The right
pane shows:

- daily market OHLC bars;
- execution markers;
- net equity and drawdown;
- exploratory metrics;
- source, artifact, execution, and cost provenance.

The data is real fixture data, not a painted placeholder. The assurance is still exploratory
because importing and rendering a valid record is not independent verification.

## 3. Ground a question in a chart range

Drag across either synchronized chart, or choose the committed maximum-drawdown range. Both charts
share the same visible window and selection.

Select **Create selection context**. The browser sends only the owned view ID, exact range, and
visible series keys. The daemon validates the range against canonical resources and returns a
summary such as market return, net return, maximum drawdown, and execution count.

Select **Ask Pi about selection**. The new task receives the durable selection reference and the
daemon-derived summary. It does not receive browser-invented metrics or an unbounded copy of the
chart. The public session log records the selection ID, so the interaction can be recovered after a
restart.

## 4. Start a separate verification attempt

In **Promote with Veil**, review the two editable fields:

- **Project-relative artifact** defaults to `artifact/daily-factor.mjs`;
- **Hypothesis** defaults to the committed cross-sectional trend statement.

Keep the artifact reference relative to the project. Absolute paths, traversal, backslashes,
symlinks, unknown fields, and files whose digest does not match the source view are rejected.

Select **Promote with Veil**. Loom verifies the handoff before creating anything, then opens a new
Veil session. The Raw session and chart remain unchanged. The attempt records its own chronology,
rereads registered data, captures the artifact, and runs the contract, pricing, cost, statistical
gate, and Experiment path.

The committed fixture currently produces a genuine `rejected` Experiment. That is expected and
useful: it proves the UI can report an unfavorable verified result without turning it into an
execution error or quietly preserving a flattering Raw metric.

## 5. Distinguish outcomes

The promotion panel can end in several materially different ways:

- **accepted**, **degraded**, or **rejected**: an archive-validated Experiment exists;
- **execution failed**: the artifact/runtime failed and no Experiment verdict was inferred;
- **cancelled**: the user stopped the task and no Experiment claim exists;
- **interrupted**: the daemon restarted before a durable terminal result, so the work must be
  retried.

Only the first group carries Veil assurance. In every case, the source Raw chart stays
**EXPLORATORY · UNVERIFIED**.

## 6. Review the evidence

When an Experiment exists, review more than its headline verdict. The evidence drawer includes:

- dataset and pricing-method identity;
- OOS sample size and periods per year;
- verified metrics with basis and scope;
- each gate outcome and reason code;
- rationale, limitations, and bounded lessons;
- archive, artifact, contract, pricing, gate, and read-set identities.

These are bounded projections of a revalidated archive. Captured code, raw pricing series, snapshot
contents, archive paths, and private diagnostics do not enter the browser.

## 7. Reproduce the Experiment

Select **Reproduce Experiment**. Veil replays the archived artifact from immutable snapshots and
recomputes pricing, metrics, and gates. No model is contacted.

The successful reference result is **matched**. This confirms that the replay identities agree with
the original archive. It does not change the original `rejected` verdict. You can use **Reproduce
again** to repeat the check or cancel a running reproduction as an ordinary task.

## 8. Test restart recovery

Leave both completed sessions in place, stop only the daemon with `Ctrl+C`, and start it again with
the same `LOOM_STATE_DIR`. Refresh the browser if needed.

The old browser cookie is rejected and replaced during bootstrap. Completed Raw and Veil event
prefixes, the selection, Experiment index, and evidence remain available. Work that lacked a
durable terminal at shutdown appears as interrupted rather than completed.

## What to take away

The workflow is intentionally asymmetric:

- exploration optimizes for speed and interaction;
- promotion pays the cost of independent execution;
- evidence is reviewed from validated records rather than model prose;
- reproduction checks identity parity without rewriting history.

For the terminology behind those boundaries, read [core concepts](core-concepts.md).
