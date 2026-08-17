"use client";

import {
  LOOM_PROFILE_DESCRIPTORS,
  type LoomCapability,
  type LoomSessionProfile,
  RAW_PI_PROFILE,
} from "@veilquant/loom-protocol";
import { useMemo, useState } from "react";
import {
  type BrowserConnectionState,
  useSessionEventStream,
} from "../hooks/use-session-event-stream";
import { resolveDaemonOrigin } from "../lib/daemon-auth";
import type { ConversationEntry, TaskProjection } from "../lib/session-projection";

const DEMO_PROJECT_ID = "daily-factor-demo";
const DEMO_SESSION_ID = "raw-pi-demo";
const DEMO_STREAM_ENABLED = process.env.NODE_ENV === "development";
const DAEMON_ORIGIN = resolveDaemonOrigin(process.env.NEXT_PUBLIC_LOOM_DAEMON_ORIGIN);

const CAPABILITY_LABELS: Readonly<Record<LoomCapability, string>> = {
  chat: "Chat",
  "local-code": "Local code",
  "loom-chart": "Live views",
  "loom-selection": "Chart grounding",
  "task-cancel": "Task control",
  "session-replay": "Session replay",
  "veil-data": "Guarded data",
  "veil-promotion": "Promotion",
  "veil-experiment": "Experiments",
  "veil-reproduction": "Reproduction",
};

export function WorkspaceShell() {
  const [profileId, setProfileId] = useState<LoomSessionProfile>("raw-pi");
  const { projection, connection } = useSessionEventStream({
    enabled: DEMO_STREAM_ENABLED,
    daemonOrigin: DAEMON_ORIGIN,
    projectId: DEMO_PROJECT_ID,
    sessionId: DEMO_SESSION_ID,
  });
  const sessionProfileId = projection.profile ?? profileId;
  const sessionFrozen = projection.profile !== undefined;
  const profile = useMemo(
    () =>
      LOOM_PROFILE_DESCRIPTORS.find((descriptor) => descriptor.id === sessionProfileId) ??
      RAW_PI_PROFILE,
    [sessionProfileId],
  );
  const latestTask = projection.tasks.at(-1);
  const activeTab = projection.activeView?.kind === "backtest" ? "Backtest" : "Explore";

  return (
    <main className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-4 py-4 sm:px-6 lg:px-8">
      <header className="mb-4 flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-black/20 px-5 py-4 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-lime-200/20 bg-[var(--accent-soft)] font-mono text-sm font-bold text-[var(--accent)]">
            VL
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide">Veil Loom</p>
            <p className="text-xs text-[var(--muted)]">
              Local-first research workspace · pre-alpha
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)]">
            Offline Pi fixture
          </span>
          <ConnectionBadge connection={connection} />
          <button
            className="cursor-not-allowed rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-[#17200e] opacity-60"
            disabled
            type="button"
          >
            {sessionFrozen ? "Pi session restored" : "Demo session"}
          </button>
        </div>
      </header>

      <section className="mb-4 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)]/90 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            Session profile
          </p>
          <p className="max-w-3xl text-sm text-slate-300">
            Raw Pi keeps every result exploratory. Veil adds a separate verification path; it never
            retroactively certifies a Raw result.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-[var(--border)] bg-black/20 p-1">
          {LOOM_PROFILE_DESCRIPTORS.map((descriptor) => (
            <button
              aria-pressed={sessionProfileId === descriptor.id}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                sessionProfileId === descriptor.id
                  ? "bg-slate-100 text-slate-950"
                  : "text-[var(--muted)] hover:text-white"
              } ${sessionFrozen ? "cursor-not-allowed opacity-60" : ""}`}
              disabled={sessionFrozen}
              key={descriptor.id}
              onClick={() => setProfileId(descriptor.id)}
              type="button"
            >
              {descriptor.label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid min-h-[680px] flex-1 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]/95 shadow-2xl shadow-black/30 lg:grid-cols-[minmax(320px,0.78fr)_minmax(520px,1.35fr)]">
        <div className="flex min-h-[560px] flex-col border-b border-[var(--border)] lg:border-r lg:border-b-0">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-base font-semibold">Research conversation</h1>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {projection.runtime === undefined
                    ? `${profile.label} · ${profile.assurance.replaceAll("-", " ")}`
                    : `${projection.runtime.provider}/${projection.runtime.model} · Pi ${projection.runtime.version}`}
                </p>
              </div>
              <span className="rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] font-bold tracking-wide text-[var(--warning)]">
                PROTOCOL FIRST
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.capabilities.map((capability) => (
                <span
                  className="rounded-md bg-[var(--panel-soft)] px-2 py-1 text-[10px] text-slate-400"
                  key={capability}
                >
                  {CAPABILITY_LABELS[capability]}
                </span>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-auto p-5">
            {projection.conversation.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
                Waiting for the deterministic demo session…
              </div>
            ) : (
              projection.conversation.map((entry) => (
                <ConversationMessage entry={entry} key={entry.id} />
              ))
            )}
            <div className="rounded-xl border border-dashed border-[var(--border)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">Daemon event stream</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {streamDescription(connection, projection.issue?.message)}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-slate-500">
                  seq {projection.lastSequence}
                </span>
              </div>
              {latestTask === undefined ? null : (
                <TaskStatus activity={projection.lastActivity} task={latestTask} />
              )}
            </div>
          </div>

          <div className="border-t border-[var(--border)] p-4">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-black/20 p-2 pl-4">
              <span className="flex-1 text-sm text-slate-500">
                Interactive composer arrives after the command fixture…
              </span>
              <button
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-slate-500"
                disabled
                type="button"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-[680px] flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <nav aria-label="Canvas views" className="flex gap-1">
              {["Explore", "Backtest", "Evidence", "History"].map((tab) => (
                <button
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    tab === activeTab
                      ? "bg-slate-100 font-semibold text-slate-950"
                      : "text-[var(--muted)]"
                  }`}
                  key={tab}
                  type="button"
                >
                  {tab}
                </button>
              ))}
            </nav>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              {projection.activeView?.title ?? "no active view"}
            </span>
          </div>

          <div className="grid flex-1 gap-4 p-5 xl:grid-rows-[1.3fr_0.9fr_auto]">
            <ChartPlaceholder
              active={projection.activeView !== undefined}
              label="Market and trades"
              variant="market"
            />
            <ChartPlaceholder
              active={projection.activeView !== undefined}
              label="Equity and drawdown"
              variant="equity"
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <MetricPlaceholder label="Assurance" value="Exploratory" />
              <MetricPlaceholder label="Evidence" value="None" />
              <MetricPlaceholder label="Selection" value="No range" />
            </div>
          </div>

          <div className="border-t border-[var(--border)] px-5 py-3">
            <p
              className={`text-xs font-semibold tracking-wide ${
                sessionProfileId === "raw-pi" ? "text-[var(--warning)]" : "text-[var(--accent)]"
              }`}
            >
              {sessionProfileId === "raw-pi"
                ? "EXPLORATORY · UNVERIFIED"
                : "VEIL VERIFICATION AVAILABLE · EXPLORATION REMAINS UNVERIFIED"}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function ConnectionBadge({ connection }: Readonly<{ connection: BrowserConnectionState }>) {
  const presentation = {
    disabled: { label: "Demo stream disabled", className: "text-[var(--muted)]" },
    connecting: { label: "Connecting daemon", className: "text-[var(--warning)]" },
    live: { label: "Daemon live", className: "text-[var(--accent)]" },
    reconnecting: { label: "Replaying events", className: "text-[var(--warning)]" },
    failed: { label: "Stream rejected", className: "text-red-300" },
  }[connection.status];

  return (
    <span
      className={`rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs ${presentation.className}`}
    >
      {presentation.label}
    </span>
  );
}

function ConversationMessage({ entry }: Readonly<{ entry: ConversationEntry }>) {
  if (entry.role === "notice") {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
        {entry.content}
      </div>
    );
  }

  return (
    <div
      className={`max-w-[92%] rounded-2xl border p-4 text-sm leading-6 ${
        entry.role === "assistant"
          ? "ml-auto rounded-tr-sm border-lime-200/10 bg-[var(--accent-soft)]/55 text-slate-200"
          : "rounded-tl-sm border-[var(--border)] bg-[var(--panel-soft)] text-slate-300"
      }`}
    >
      {entry.content}
      {entry.complete ? null : <span className="ml-1 animate-pulse text-[var(--accent)]">▍</span>}
    </div>
  );
}

function TaskStatus({
  activity,
  task,
}: Readonly<{ activity: string | undefined; task: TaskProjection }>) {
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">{task.label}</span>
        <span className="font-mono text-slate-500">{task.status}</span>
      </div>
      {activity === undefined ? null : (
        <p className="mt-1 text-[10px] text-slate-500">Latest Pi activity: {activity}</p>
      )}
    </div>
  );
}

function streamDescription(connection: BrowserConnectionState, issue: string | undefined): string {
  if (issue !== undefined) return issue;
  if (connection.status === "live")
    return "Durable replay is current; new events will appear here.";
  if (connection.status === "reconnecting") {
    return `Reconnecting from the last applied sequence (attempt ${connection.attempt}).`;
  }
  if (connection.status === "failed") return "The stream failed closed after a protocol error.";
  if (connection.status === "disabled") return "Run both development processes to enable the demo.";
  return "Opening the deterministic offline Pi event stream…";
}

function ChartPlaceholder({
  active,
  label,
  variant,
}: Readonly<{ active: boolean; label: string; variant: "market" | "equity" }>) {
  const bars = variant === "market" ? [32, 48, 40, 68, 52, 76, 60, 45, 70, 58, 82, 64] : [];

  return (
    <section className="relative min-h-48 overflow-hidden rounded-xl border border-[var(--border)] bg-black/15 p-4">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-300">{label}</h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-600">
          {active ? "demo fixture" : "waiting for view"}
        </span>
      </div>
      <div className="absolute inset-x-4 bottom-5 top-14 flex items-end gap-2 border-b border-l border-slate-700/70 px-3 pt-3">
        {variant === "market" ? (
          bars.map((height) => (
            <div
              className="flex-1 rounded-t-sm bg-gradient-to-t from-lime-300/15 to-lime-200/55"
              key={height}
              style={{ height: `${height}%` }}
            />
          ))
        ) : (
          <svg
            aria-label="Placeholder equity curve"
            className="size-full"
            role="img"
            viewBox="0 0 600 180"
          >
            <title>Placeholder equity curve</title>
            <path
              d="M0 145 C55 132, 80 148, 120 118 S190 92, 225 108 S290 120, 330 72 S410 85, 455 42 S535 58, 600 24"
              fill="none"
              opacity="0.65"
              stroke="var(--accent)"
              strokeWidth="3"
            />
          </svg>
        )}
      </div>
    </section>
  );
}

function MetricPlaceholder({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-black/15 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-300">{value}</p>
    </div>
  );
}
