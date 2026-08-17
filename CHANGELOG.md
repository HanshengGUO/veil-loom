# Changelog

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
