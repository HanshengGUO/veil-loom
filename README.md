# Loom

[简体中文](README.zh-CN.md)

**An AI-native workspace for quantitative research.**

> Work with a research agent on the left. Explore interactive backtests on the right. Select any
> period on the chart and keep investigating.

Loom gives quantitative researchers one place to work with a coding agent and understand what it
produces. The agent can inspect a local project, write code, run tools, and launch a backtest. Loom
turns the result into an interactive research canvas with market data, entries and exits, equity,
drawdown, metrics, and run history.

When something on the chart looks interesting, select it and ask a follow-up. The agent receives
the exact range and a structured summary, so the next step starts from what you are looking at—not
from a screenshot or a timestamp copied into chat.

## What Loom looks like

```text
┌─ Research agent ─────────────────┬─ Research canvas ───────────────────┐
│                                 │                                    │
│  You: Test this factor           │  Market + entries and exits         │
│  Agent: editing and running...   │  ─────▲────▼────────▲────────        │
│                                 │                                    │
│  Tool and task progress          │  Equity + drawdown                  │
│  Research notes                  │  ╱╲____╱╲______                      │
│  Previous runs                   │                                    │
│                                 │  Metrics and provenance             │
│  You: Why did it fail here?  ◀──┤  [ selected drawdown range ]        │
│                                 │                                    │
└─────────────────────────────────┴────────────────────────────────────┘
```

The conversation and canvas are two views of the same research session. A backtest published by
the agent appears on the canvas; a range selected on the canvas becomes context for the agent.

## The research loop

Loom is designed around a simple workflow:

1. **Start with an idea.** Ask the agent to inspect data, change a factor, or test a strategy.
2. **Let the agent work in the project.** Code edits, tools, and backtests run in the local
   environment.
3. **See the result, not just the log.** Loom renders the market, trades, equity, drawdown, metrics,
   and provenance as one synchronized view.
4. **Investigate visually.** Zoom, pan, compare executions, or select a regime such as the maximum
   drawdown.
5. **Ask about what you selected.** The selected range goes back into the conversation as precise,
   reusable context.
6. **Iterate without losing the thread.** Sessions, tasks, views, and selections remain available
   after a restart.

This is the product: a tighter feedback loop between an agent that can do the work and a researcher
who needs to see, question, and steer it.

## Why Loom exists

Coding agents are already useful for editing research code and running commands, but a terminal
transcript is a poor interface for understanding a strategy. Quantitative work is visual: you need
to line up trades with the market, see where equity changes shape, inspect drawdowns, and compare
one period with another.

Today that usually means jumping between chat, terminal, notebook, static chart, and backtest
report. Context gets lost at every handoff. Loom brings those pieces into one continuous workspace
and makes the chart a first-class way to communicate with the agent.

Loom is not a new backtest engine. It is meant to sit on top of the tools and frameworks a research
team already uses. Backtest adapters translate their results into Loom's visual model.

## Try the developer preview

The current preview uses a committed daily-factor project and Pi's offline test provider. It needs
no model account, API key, or private market data.

You need Node.js 22.19 or newer:

```bash
git clone https://github.com/HanshengGUO/veil-loom.git
cd veil-loom
npm ci
```

Start the daemon and Web app in separate terminals:

```bash
npm run dev:daemon
```

```bash
npm run dev:web
```

Open exactly `http://127.0.0.1:3000`.

The demo opens a completed research session and a real interactive backtest view. From there you
can inspect synchronized charts, choose the maximum-drawdown range, create a selection, ask Pi
about it, and restart the daemon to see the session recover.

For a guided walkthrough, continue with [Getting started](docs/getting-started.md) and
[Research workflow](docs/research-workflow.md).

## What works today

The developer preview includes:

- a two-pane conversation and research canvas;
- a real programmatic Pi session using an offline provider;
- one strict adapter for the committed daily-factor example;
- synchronized market, execution, equity, and drawdown views;
- chart selections that can be sent back to Pi;
- durable sessions, tasks, views, and restart recovery;
- an optional independent review flow for a completed result.

It does not yet include a general project picker, real model-provider setup, automatic backtest
framework discovery, a desktop installer, remote access, L2/L3 visualizations, or autonomous
research. The current vertical slice is there to make the interaction model concrete before the
project broadens to more adapters and real user projects.

## Optional verification

Loom can send a promising result to [Veil](https://github.com/HanshengGUO/veil) for a separate
verification and reproduction attempt. This is an optional extension of the workflow, not the
definition of Loom: the core product is the visual, agent-assisted research workspace described
above.

## Documentation

- [Getting started](docs/getting-started.md)
- [Research workflow](docs/research-workflow.md)
- [Core concepts](docs/core-concepts.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Security model](docs/security.md)
- [Contributing a backtest adapter](docs/contributing-adapters.md)
- [Clean-machine acceptance](docs/clean-machine-acceptance.md)
- [Contribution guide](CONTRIBUTING.md), [security reporting](SECURITY.md), and
  [changelog](CHANGELOG.md)

English is the default documentation language. Every document links to a complete Simplified
Chinese counterpart beneath its title.

## Development

Run the repository gate before opening a pull request:

```bash
npm run check
```

Run the built-product acceptance before a release or platform-sensitive change:

```bash
npm run accept:clean-machine
```

The same acceptance runs in CI on Linux, macOS, and Windows. See
[Clean-machine acceptance](docs/clean-machine-acceptance.md) for details.

## License

MIT.
