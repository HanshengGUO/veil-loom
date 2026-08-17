# Security model

Veil Loom is local-first, but localhost alone is not an authentication boundary. The daemon will use
a startup token, strict Origin validation, loopback-only binding, project capabilities, and
content-addressed blob identifiers.

## Protected values

The browser must not receive:

- provider credentials or unrestricted environment values;
- absolute private data roots;
- arbitrary host file paths;
- private child-process diagnostics;
- raw data unless an explicit bounded view allows it;
- authority to label evidence as verified.

## Non-goals

The initial release does not defend against a deliberately malicious local user or provide an
operating-system sandbox. Pi tools and user backtests run with the user's permissions. Remote daemon
binding and multi-user access are not supported.
