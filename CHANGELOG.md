# Changelog

[简体中文](CHANGELOG.zh-CN.md)

All notable changes to Veil Loom will be documented here.

The project follows semantic versioning after its first published package. Protocol format versions
are tracked independently from package versions.

## Unreleased

### Added

- Initial Next.js, Tailwind, Node daemon, and shared protocol repository scaffold.
- Raw Pi and Veil profile descriptors with an explicit assurance boundary.
- Versioned session event envelopes and redacted API errors.
- Durable per-session append-before-broadcast logs with restart replay.
- Cursor-based JSON replay and reconnectable server-sent event streams.
- Gap-aware browser projections with exact duplicate detection and explicit cursor recovery.
- An idempotent durable Raw Pi demo session rendered in the dual-pane development shell.
- Per-process 256-bit daemon sessions delivered through an Origin-gated HttpOnly cookie handshake.
- Credentialed direct SSE, strict CORS responses, token rotation, and real loopback binding tests.
- A real Raw Pi `AgentSession` host with a deterministic offline provider and inline Loom extension.
- Versioned session, message, and cancellation commands with durable redacted Pi event projection.
- Pi package/provider/model fingerprints, cancellation coverage, and provider-error redaction tests.
- A strict `loom.backtest-import.v0` reference adapter with bigint-safe time and explicit metric,
  execution, assurance, and provenance semantics.
- Atomically published content-addressed view/blob resources with ownership-bound read APIs and
  fixed JSON size limits.
- Real OHLC, trade, net-equity, drawdown, metric, and provenance projection in the Web canvas.
- One synchronized chart viewport with crosshair, selection, zoom, pan, and origin de-duplication.
- Ownership-bound chart selections with daemon-derived summaries and a bounded Raw Pi context
  round trip.
- Startup discovery and fail-closed reconciliation for durable Raw Pi sessions.
- Persisted Pi conversation continuity with ownership markers, exact runtime matching, and bounded
  public-transcript reconstruction for legacy sessions.
- Explicit `task.interrupted` terminals for work that lacked a durable result when the daemon
  stopped.
- A version-pinned `veil-quant` runtime boundary, daemon-authorized project registry, and exact
  path-free `loom.project-readiness.v0` response.
- Restart-resilient Veil Pi sessions that load the public Veil extension while keeping all Loom
  views exploratory until independent evidence is projected.
- A Web readiness client that fails closed on forged ownership, malformed data, and oversized
  responses and enables the Veil profile only for ready projects.
- An exact `loom.promotion.create.v0` handoff that accepts only an owned view, project-relative
  artifact, and hypothesis, with no Raw metric or expected-result fields.
- Separate Veil verification sessions with private hypothesis/data/run chronology, guarded data
  reads, cancellable independent re-execution, and restart-safe task semantics.
- Archive-validated `veil.verification_started`, coarse stage, and `veil.experiment_recorded`
  projections that keep execution failure distinct from a rejected Experiment.
- A committed Veil-compatible two-session momentum artifact and 35-session, four-entity panel for
  the end-to-end promotion fixture.
- A Web **Promote with Veil** action that preserves the Raw view's exploratory label while showing
  the new attempt's real task and Experiment outcome.
- A bounded project Experiment index and archive-revalidated `loom.experiment-evidence.v0`
  projection with method, dataset, cost, metric, gate, limitation, and lineage details.
- Explicit cancellable reproduction tasks through Veil's public archive/snapshot replay API, with a
  fail-closed matched-identity event that never changes the original verdict.
- An Experiment evidence drawer and refresh recovery for completed attempts, without exposing
  artifact code, raw pricing payloads, snapshot contents, or private paths to the browser.
- A dependency-free clean-machine runner for the built Web app and daemon that exercises the full
  reference workflow, restart recovery, and reproduction on Linux, macOS, and Windows CI.
- A complete Simplified Chinese documentation set with reciprocal language navigation while English
  remains the canonical default.
- Bilingual getting-started, research-workflow, core-concepts, and troubleshooting guides grounded
  in the current developer preview.

### Fixed

- Resolve the committed demo project from the daemon module rather than npm's workspace working
  directory, so the documented `npm run dev:daemon` path reports real Veil readiness.
