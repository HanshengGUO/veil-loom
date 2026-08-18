# Getting started

[简体中文](getting-started.zh-CN.md)

Veil Loom is currently a developer preview, not an installed desktop application or published npm
CLI. The supported first run is the deterministic daily-factor workflow in this repository. It is
fully local, uses Pi's offline faux provider, and needs no model API key.

## Before you start

You need:

- Git;
- Node.js 22.19 or newer;
- npm 11 or the npm version bundled with a compatible Node release;
- two terminal windows;
- a browser that can open an exact loopback address.

Check the runtime before installing:

```bash
node --version
npm --version
```

## Install the repository

```bash
git clone https://github.com/HanshengGUO/veil-loom.git
cd veil-loom
npm ci
```

Use `npm ci` when you want the committed dependency tree exactly as tested. Use `npm install` only
when you intend to change dependencies or refresh the lockfile.

Contributors should run the full gate before opening a pull request:

```bash
npm run check
```

The full gate runs formatting checks, TypeScript, tests, and production builds. It can take several
minutes on Windows. You do not need to repeat it after every documentation edit.

## Start the developer preview

From the repository root, start the daemon in the first terminal:

```bash
npm run dev:daemon
```

The command builds the shared protocol package, starts the local daemon on
`http://127.0.0.1:43120`, registers the committed daily-factor project, and creates an idempotent
Raw Pi demo session through the offline provider.

Start the Web app in the second terminal:

```bash
npm run dev:web
```

Open exactly:

```text
http://127.0.0.1:3000
```

Do not replace `127.0.0.1` with `localhost`. The daemon deliberately checks the exact browser
Origin, and the two names are not interchangeable at this security boundary.

## What a healthy first run looks like

After the page connects, you should see:

- **Offline Pi fixture** and **Daemon live** in the header;
- a path-free message such as **Veil 0.1.0 ready**;
- a restored `raw-pi` session with a completed reference-backtest tool call;
- actual market, net-equity, drawdown, trade, metric, and provenance views;
- **EXPLORATORY · UNVERIFIED** beneath the source chart;
- an enabled **Promote with Veil** panel once the Raw view and readiness checks are complete.

The demo session is created before the browser connects. The profile selector therefore describes
the available profiles but is frozen for that session. Promotion creates a new Veil session; it
does not mutate the Raw session.

Continue with the [research workflow](research-workflow.md) to create a chart selection, ask Pi
about it, promote the artifact, inspect the Experiment, and reproduce it.

## Use an isolated state directory

Loom normally stores durable state in the platform's per-user application-state directory. For a
disposable demo or documentation walkthrough, point the daemon at a fresh directory before starting
it.

macOS or Linux:

```bash
LOOM_STATE_DIR=/tmp/veil-loom-walkthrough npm run dev:daemon
```

Windows PowerShell:

```powershell
$env:LOOM_STATE_DIR = "$env:TEMP\veil-loom-walkthrough"
npm run dev:daemon
```

Restarting with the same directory demonstrates session recovery. Choosing a different empty
directory starts a separate local history. Treat an existing state directory as user data; do not
delete it just to resolve an unrelated startup problem.

## Run the release-facing smoke

For a platform-sensitive change or release check, use:

```bash
npm run accept:clean-machine
```

This builds the production app and daemon, copies the reference project into temporary storage, and
drives the full public workflow through HTTP. It removes the temporary project and state afterward.
See [clean-machine acceptance](clean-machine-acceptance.md) for the exact contract.

## Current scope

This preview demonstrates one committed adapter and one public fixture. It does not yet provide a
general project picker, real-provider credential UI, arbitrary framework discovery, a packaged
desktop app, or remote access. If you want to add another backtest format, begin with
[contributing a backtest adapter](contributing-adapters.md) rather than teaching the browser to read
local files directly.

Stop both development processes with `Ctrl+C` when you are finished. If the first run does not match
the description above, see [troubleshooting](troubleshooting.md).
