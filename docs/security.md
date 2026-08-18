# Security model

Veil Loom is local-first, but localhost alone is not an authentication boundary. The Web app and
daemon bind to `127.0.0.1` and the daemon combines strict Origin checks with a process-scoped session
credential. Remote binding and user-configured network proxies are unsupported.

## Browser handshake

At startup, the daemon generates a 256-bit random token and keeps it out of logs and API bodies. The
configured Web Origin may call `POST /v0/auth/bootstrap`; no other Origin, including `null`, may
bootstrap. The response sets the token as a host-only session cookie with:

- `HttpOnly`, so browser JavaScript cannot read it;
- `SameSite=Strict`, so a cross-site request does not carry it;
- `Path=/v0`, so it is limited to daemon API paths;
- no `Max-Age` or `Expires`, so the daemon does not request persistent storage.

The acknowledgement contains only `{ "format": "loom.auth.v0", "status": "ready" }`. Native
EventSource cannot set an Authorization header, so it connects with credentials enabled. The token
is never put in a query string, URL fragment, local storage, browser history, or Referer header.

The v0 transport is plain HTTP over loopback, so the cookie does not claim a `Secure` attribute.
HTTPS or any non-loopback transport would require a separate design and a Secure cookie; it is not a
supported configuration.

## Request checks

Health remains available without a credential for local process supervision. Every other browser
route requires the exact configured Origin and a valid session cookie. CORS replies echo only that
Origin, allow credentials, and never use a wildcard. A daemon restart rotates the token, invalidates
the old cookie, and causes the Web client to bootstrap again before reconnecting its event cursor.

These controls defend against an unrelated website reaching a user's loopback daemon. They do not
attempt to defend against a malicious process already running as the same operating-system user.

## Protected values

The browser must not receive:

- provider credentials or unrestricted environment values;
- absolute private data roots;
- arbitrary host file paths;
- private child-process diagnostics;
- raw data unless an explicit bounded view allows it;
- authority to label evidence as verified.

Session logs accept only versioned, JSON-safe event envelopes. Public API failures use stable error
codes and do not return storage paths or private filesystem diagnostics.

Project roots are daemon configuration, not request data. At startup the daemon binds a portable
project ID to one canonical non-root directory. The browser can ask for that ID's readiness but
cannot submit, replace, or traverse a host path. The public summary contains only the tested Veil
version, formats, capabilities, and aggregate counts. Veil's public diagnostics are bounded and
have the registered root removed again at the Loom boundary before they reach the browser.

The installed `veil-quant` package is trusted daemon code and runs with the user's permissions; its
presence is not a sandbox. Loom checks a pinned minor range and public API shape before loading it.
An incompatible runtime or invalid project keeps the Veil profile unavailable while Raw Pi remains
usable. Capability readiness never grants verified assurance.

Promotion does not turn the browser into a filesystem or evidence authority. Its request accepts
only an owned view ID, one normalized project-relative artifact reference, and a bounded hypothesis.
The daemon resolves the file beneath the registered canonical root, follows it only if the final
canonical path remains inside that root, enforces a 1 MiB limit, and hashes the bytes against the
source view before it creates a target session. The browser cannot choose the dataset, Veil request
file, protocol, cost model, gates, expected result, or assurance. The selected file itself must be a
regular file rather than a symlink.

Generated promotion requests live under the already validated project `.veil` directory and use an
exclusive, daemon-generated attempt filename. They contain a new Veil read-set ID and the
daemon-owned adapter recipe, never Raw chart metrics. The selected artifact is hashed again before
the request is written. Veil executes it in its framed child artifact runtime; Loom receives only the
public tool result and does not echo child paths or stderr. Process framing is not an OS sandbox.

The source Raw log is not modified. A separate Veil session owns the private hypothesis/data/run
ledger and public task events. Loom accepts non-exploratory assurance only after Veil's public
archive loader verifies the Experiment and its hashes match the tool result. A child failure,
malformed archive, cancellation, or interrupted task exposes no rejected or accepted state. Public
events contain portable artifact and evidence identities, not project roots or archive paths.

Experiment review remains a projection boundary. The project index contains only durable portable
identities. Opening an Experiment reloads and verifies its archive, then returns a size-limited
summary of method/data identities, aggregate metrics, gate reason codes, limitations, and hashes.
The browser never receives captured artifact code, raw Arrow/pricing series, snapshot contents,
archive references, or the project root.

A reproduction request contains only the owned session and Experiment identities. The browser
cannot supply expected metrics, a desired verdict, snapshot paths, code, pricing settings, or gates.
Veil replays the archive inside the daemon's existing local authority. Loom publishes `matched` only
after every returned identity validates; errors, cancellation, retention deletion, and restart do
not produce a match. Reproduction confirms parity and has no authority to change the Experiment's
original verdict.

Pi's event stream is an internal input, not a public passthrough. Loom publishes visible assistant
text and coarse lifecycle facts, but drops thinking blocks, tool arguments, tool result bodies, and
provider error messages. The committed CI/development provider is Pi's in-memory faux provider with
network refresh disabled; its sole Loom reference tool has no filesystem, shell, or network access.

Pi conversation files are private daemon state, not a second public source of truth. On restart the
daemon requires the stored Loom ownership marker and exact public runtime fingerprint before using
one. A Pi transcript can restore conversational context, but only the append-only Loom log can
declare task completion. Any Loom task without a durable terminal event becomes `task.interrupted`.
For legacy sessions without a Pi file, reconstruction is limited to recent public user messages and
completed assistant text; tool data, deltas, diagnostics, and raw series are excluded.

The reference tool does not treat arbitrary model or tool JSON as chart data. It invokes one
explicit adapter, which validates the complete import and size limits before any resource is made
visible. Only the resulting view descriptor enters the session log. Series live in immutable
content-addressed records, and reads require the descriptor's project, session, view, and blob
association. The browser validates each record again before rendering it. The committed market
fixture is intentionally public; private project data remains outside the browser until a separately
authorized bounded-view design exists.

Chart selection does not widen that view boundary. The browser cannot provide selection metrics or
agent context: it submits only an owned view ID, exact time range, and visible series keys. The
daemon reloads canonical blobs, limits the range to 1,024 observations, derives the summary, and
writes it to the owned session log before it can be used in a prompt. Pi receives the bounded
summary and portable view reference, never the raw series through the selection command. Forged,
out-of-range, mixed-unit, unavailable-series, and cross-session selections fail closed.

## Non-goals

The initial release does not defend against a deliberately malicious local user, dependency, or
project configuration, and it does not provide an operating-system sandbox. Pi tools, Veil tools,
and user backtests run with the user's permissions. A project-relative artifact selection is not an
OS sandbox or a review of the code's intent. Remote daemon binding and multi-user access are not
supported.
