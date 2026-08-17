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

## Non-goals

The initial release does not defend against a deliberately malicious local user or provide an
operating-system sandbox. Pi tools and user backtests run with the user's permissions. Remote daemon
binding and multi-user access are not supported.
