# Core concepts

[简体中文](core-concepts.zh-CN.md)

Veil Loom makes more sense once a few words are kept separate. Most of its design exists to prevent
a convenient research view from quietly becoming a stronger claim than its evidence supports.

## Local-first is not a sandbox

The browser, daemon, Pi, Veil, and user tools run on the same machine. Research state stays local by
default, and the daemon listens only on loopback. That is a privacy and deployment choice, not an
operating-system sandbox. Pi shell commands, Veil runtimes, and user code still run with the user's
permissions.

The browser is treated as an untrusted presentation surface. It receives bounded projections, not
provider credentials, unrestricted paths, private process diagnostics, or authority to declare a
result verified.

## Project and readiness

A **project** is a daemon-authorized local root identified to the browser by a portable project ID.
The browser cannot submit a filesystem path. For a Veil-capable project, the root contains a Veil
declaration and registered data/runtime configuration.

**Readiness** answers one question: can the tested Veil package and this project load? It can be
`ready`, `invalid`, or `unavailable`. Ready does not mean a strategy, chart, metric, or claim has
been verified. It only enables a new verification attempt.

## Session profiles

A session freezes one profile when it starts:

- **Raw Pi** provides Pi, Loom conversation, local work, charts, selections, cancellation, and
  replay. Every research result remains exploratory.
- **Veil** adds the version-pinned `veil-quant` capability. It can run guarded data and promotion
  workflows, but ordinary work in the session is still exploratory until evidence is produced.

Changing a UI badge cannot convert one profile into the other. Promoting a Raw result creates a new
Veil session with its own task history and ledger.

## Assurance

Assurance describes what the evidence permits Loom to say, not whether a number looks attractive.

| State | Issuer | Meaning |
| --- | --- | --- |
| `exploratory` | Loom | Useful research output with no independent Veil evidence |
| `contract-verified-unverified` | Veil | A contract record exists, but there is no final citable Experiment verdict |
| `accepted` | Veil | The verified Experiment passed the applicable decision path |
| `degraded` | Veil | Evidence exists, but limitations or gates require a qualified result |
| `rejected` | Veil | A real Experiment completed and its decision path rejected the claim |

`rejected` is not a synonym for “the program crashed.” Execution failure, cancellation, malformed
evidence, and restart interruption produce task terminals without an Experiment verdict.

## Task, event, and recovery

A **task** is long-running work owned by the daemon. HTTP only acknowledges that it started; ordered
session events report progress and the terminal result.

The append-only Loom event log is the public source of truth. An event is synced before it is
broadcast. On restart, work with no durable terminal event becomes `task.interrupted`; Loom never
uses a model transcript or an output file to guess that it succeeded.

Pi also has a private conversation file. It can restore context when the runtime identity matches,
but it cannot create or upgrade a Loom task result.

## View, blob, and provenance

A **view** is validated metadata for a research result. Large chart values live in immutable
content-addressed **blobs**, while the session event contains only a bounded descriptor. Every view
is tied to the project, session, task, adapter, source digest, artifact digest, and run provenance
that created it.

The reference backtest view contains market, net-equity, drawdown, and trade resources. Its metrics
remain exploratory even when the import is perfectly valid: schema validity is not statistical
verification.

## Selection

A **selection** is a durable, bounded reference to part of an owned chart. The browser submits the
view ID, exact endpoints, and visible series keys. The daemon reloads canonical blobs and computes
the summary itself. Pi receives the range, portable view reference, and derived summary—not the raw
series through this command.

This makes questions such as “what happened during the maximum drawdown?” grounded and replayable
without trusting browser-computed metrics.

## Promotion

**Promotion** is an explicit handoff from exploration to a fresh verification attempt. The browser
sends only:

- the owned Raw view ID;
- a project-relative artifact reference;
- the hypothesis statement.

The daemon verifies ownership and the artifact digest, creates a separate Veil session, rereads the
registered data, and executes the fixed contract/pricing/gate recipe. Raw Sharpe, returns, equity,
and other displayed values are never copied in as expected results.

## Experiment and evidence

An **Experiment** is Veil's persisted result of the independent execution path. Loom reloads the
archive and validates its identities before projecting a verdict. The evidence view exposes bounded
method, dataset, cost, sample, metric, gate, limitation, and lineage details, while artifact source,
raw pricing data, snapshots, private paths, and diagnostics stay in the daemon.

The project Experiment index is a convenience for refresh and review. It points to evidence; it
does not issue new evidence.

## Reproduction

**Reproduction** replays the archived artifact, immutable read-set snapshots, pricing, and gates.
It does not rerun the model conversation. A `matched` result means Experiment, pricing,
gate-evaluation, metric, and reproduction identities agree with the archive.

A match confirms identity parity. It does not turn `rejected` into `accepted`, remove limitations,
or retroactively verify the source Raw chart.

## A useful mental model

```text
Raw exploration
  → owned view and artifact identity
  → explicit promotion
  → independent Veil execution
  → archive-validated Experiment
  → optional exact reproduction
```

The arrows represent new records and new evidence. They are not cosmetic status changes on one
mutable result.
