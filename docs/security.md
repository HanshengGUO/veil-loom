# Security model

Veil Loom is local-first, but localhost alone is not an authentication boundary. The daemon will use
a startup token, strict Origin validation, loopback-only binding, project capabilities, and
content-addressed blob identifiers.

The current pre-alpha daemon binds only to `127.0.0.1` and exposes read-only health, capability,
event replay, and event stream routes. Startup-token and Origin enforcement are the next security
milestone and must land before browser-triggered local execution. Do not expose this daemon through
a user-configured proxy or a non-loopback bind.

The development web server also binds to `127.0.0.1`. Its temporary rewrite matches only the demo
session SSE route, accepts only an HTTP loopback destination, and is absent from production builds.
It is not the eventual authenticated daemon transport.

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
