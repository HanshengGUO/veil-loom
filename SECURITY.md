# Security

## Reporting

Use GitHub's private vulnerability reporting on this repository's **Security** tab. Do not open a
public issue for an exploitable finding.

## Current boundary

Veil Loom is a local application with access to user-authorized projects and local processes. The
daemon binds to loopback by default. The browser is an untrusted presentation surface and must not
receive provider credentials, raw environment values, unrestricted paths, or evidence authority.

Pi's ordinary shell executes with the user's permissions. The pre-alpha scaffold does not provide a
container or operating-system sandbox. Do not expose the daemon to another host.

The first security implementation milestone covers loopback binding, startup authentication,
strict Origin checks, project path and symlink boundaries, child environment allowlisting, output
limits, and event-payload redaction.
