"use client";

import {
  LOOM_PROFILE_DESCRIPTORS,
  type LoomCapability,
  type LoomSessionProfile,
  RAW_PI_PROFILE,
} from "@veilquant/loom-protocol";
import { useMemo, useState } from "react";

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
  const profile = useMemo(
    () =>
      LOOM_PROFILE_DESCRIPTORS.find((descriptor) => descriptor.id === profileId) ?? RAW_PI_PROFILE,
    [profileId],
  );

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
            Example project
          </span>
          <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)]">
            Daemon offline
          </span>
          <button
            className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-[#17200e] transition hover:brightness-105"
            type="button"
          >
            Start session
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
              aria-pressed={profileId === descriptor.id}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                profileId === descriptor.id
                  ? "bg-slate-100 text-slate-950"
                  : "text-[var(--muted)] hover:text-white"
              }`}
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
                  {profile.label} · {profile.assurance.replaceAll("-", " ")}
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
            <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--panel-soft)] p-4 text-sm leading-6 text-slate-300">
              Open the daily factor example and show me where the strategy struggled out of sample.
            </div>
            <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm border border-lime-200/10 bg-[var(--accent-soft)]/55 p-4 text-sm leading-6 text-slate-200">
              The repository scaffold is ready. The next implementation slice will stream an ordered
              Pi session here and publish the first validated exploratory view to the canvas.
            </div>
            <div className="rounded-xl border border-dashed border-[var(--border)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">Daemon event stream</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Append-before-broadcast and reconnect replay are the next issue.
                  </p>
                </div>
                <span className="font-mono text-[10px] text-slate-500">not connected</span>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border)] p-4">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-black/20 p-2 pl-4">
              <span className="flex-1 text-sm text-slate-500">
                Connect the daemon to send a message…
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
              {["Explore", "Backtest", "Evidence", "History"].map((tab, index) => (
                <button
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    index === 0
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
              no active view
            </span>
          </div>

          <div className="grid flex-1 gap-4 p-5 xl:grid-rows-[1.3fr_0.9fr_auto]">
            <ChartPlaceholder label="Market and trades" variant="market" />
            <ChartPlaceholder label="Equity and drawdown" variant="equity" />

            <div className="grid gap-3 sm:grid-cols-3">
              <MetricPlaceholder label="Assurance" value="Exploratory" />
              <MetricPlaceholder label="Evidence" value="None" />
              <MetricPlaceholder label="Selection" value="No range" />
            </div>
          </div>

          <div className="border-t border-[var(--border)] px-5 py-3">
            <p
              className={`text-xs font-semibold tracking-wide ${
                profileId === "raw-pi" ? "text-[var(--warning)]" : "text-[var(--accent)]"
              }`}
            >
              {profileId === "raw-pi"
                ? "EXPLORATORY · UNVERIFIED"
                : "VEIL VERIFICATION AVAILABLE · EXPLORATION REMAINS UNVERIFIED"}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function ChartPlaceholder({
  label,
  variant,
}: Readonly<{ label: string; variant: "market" | "equity" }>) {
  const bars = variant === "market" ? [32, 48, 40, 68, 52, 76, 60, 45, 70, 58, 82, 64] : [];

  return (
    <section className="relative min-h-48 overflow-hidden rounded-xl border border-[var(--border)] bg-black/15 p-4">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-300">{label}</h2>
        <span className="text-[10px] uppercase tracking-widest text-slate-600">
          waiting for data
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
