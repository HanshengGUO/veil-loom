"use client";

import {
  LOOM_PROFILE_DESCRIPTORS,
  type LoomAcceptedCommandResponse,
  type LoomCapability,
  type LoomPromotionAcceptedResponse,
  type LoomSelection,
  type LoomSessionProfile,
  RAW_PI_PROFILE,
} from "@veilquant/loom-protocol";
import { useEffect, useMemo, useState } from "react";
import { type BacktestViewState, useBacktestView } from "../hooks/use-backtest-view";
import {
  type ExperimentEvidenceState,
  useExperimentEvidence,
} from "../hooks/use-experiment-evidence";
import { useProjectExperiments } from "../hooks/use-project-experiments";
import { type ProjectReadinessState, useProjectReadiness } from "../hooks/use-project-readiness";
import {
  type BrowserConnectionState,
  useSessionEventStream,
} from "../hooks/use-session-event-stream";
import { resolveDaemonOrigin } from "../lib/daemon-auth";
import { reproduceVeilExperiment } from "../lib/experiment-client";
import { cancelVeilPromotion, createVeilPromotion } from "../lib/promotion-client";
import type {
  ConversationEntry,
  SessionProjection,
  TaskProjection,
} from "../lib/session-projection";
import { BacktestCanvas } from "./backtest-canvas";

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
  const [artifactReference, setArtifactReference] = useState("artifact/daily-factor.mjs");
  const [hypothesisStatement, setHypothesisStatement] = useState(
    "The strongest cross-sectional price trend remains positive out of sample after costs.",
  );
  const [promotionReceipt, setPromotionReceipt] = useState<LoomPromotionAcceptedResponse>();
  const [promotionPending, setPromotionPending] = useState(false);
  const [promotionError, setPromotionError] = useState<string>();
  const [cancelPending, setCancelPending] = useState(false);
  const [reproductionReceipt, setReproductionReceipt] = useState<
    LoomAcceptedCommandResponse & { readonly taskId: string }
  >();
  const [reproductionPending, setReproductionPending] = useState(false);
  const [dismissedExperimentId, setDismissedExperimentId] = useState<string>();
  const projectReadiness = useProjectReadiness({
    enabled: DEMO_STREAM_ENABLED,
    daemonOrigin: DAEMON_ORIGIN,
    projectId: DEMO_PROJECT_ID,
  });
  const projectExperiments = useProjectExperiments({
    enabled: DEMO_STREAM_ENABLED,
    daemonOrigin: DAEMON_ORIGIN,
    projectId: DEMO_PROJECT_ID,
  });
  const { projection, connection } = useSessionEventStream({
    enabled: DEMO_STREAM_ENABLED,
    daemonOrigin: DAEMON_ORIGIN,
    projectId: DEMO_PROJECT_ID,
    sessionId: DEMO_SESSION_ID,
  });
  const promotionStream = useSessionEventStream({
    enabled: DEMO_STREAM_ENABLED && promotionReceipt !== undefined,
    daemonOrigin: DAEMON_ORIGIN,
    projectId: DEMO_PROJECT_ID,
    sessionId: promotionReceipt?.sessionId ?? "promotion-pending",
  });
  const experiment = promotionStream.projection.veilAttempt?.experiment;
  const evidence = useExperimentEvidence({
    enabled: DEMO_STREAM_ENABLED && promotionReceipt !== undefined && experiment !== undefined,
    daemonOrigin: DAEMON_ORIGIN,
    projectId: DEMO_PROJECT_ID,
    sessionId: promotionReceipt?.sessionId ?? "experiment-pending",
    experimentId: experiment?.experimentId ?? `sha256:${"0".repeat(64)}`,
    attemptId: promotionReceipt?.attemptId ?? "attempt-pending",
  });
  useEffect(() => {
    if (promotionReceipt !== undefined || projectExperiments.status !== "ready") return;
    const latest = projectExperiments.index.experiments.find(
      (candidate) =>
        candidate.sourceSessionId === DEMO_SESSION_ID &&
        candidate.experimentId !== dismissedExperimentId,
    );
    if (latest === undefined) return;
    setPromotionReceipt({
      format: "loom.promotion.accepted.v0",
      commandId: latest.commandId,
      projectId: DEMO_PROJECT_ID,
      sourceSessionId: latest.sourceSessionId,
      sessionId: latest.sessionId,
      taskId: latest.taskId,
      attemptId: latest.attemptId,
    });
  }, [dismissedExperimentId, projectExperiments, promotionReceipt]);
  const backtestView = useBacktestView({
    enabled: DEMO_STREAM_ENABLED,
    daemonOrigin: DAEMON_ORIGIN,
    projectId: DEMO_PROJECT_ID,
    sessionId: DEMO_SESSION_ID,
    descriptor: projection.activeView,
  });
  const sessionProfileId = projection.profile ?? profileId;
  const sessionFrozen = projection.profile !== undefined;
  const veilReady = projectReadiness.status === "ready";
  const profile = useMemo(
    () =>
      LOOM_PROFILE_DESCRIPTORS.find((descriptor) => descriptor.id === sessionProfileId) ??
      RAW_PI_PROFILE,
    [sessionProfileId],
  );
  const latestTask = projection.tasks.at(-1);
  const latestProjectedReproductionTask = [...promotionStream.projection.tasks]
    .reverse()
    .find((candidate) => candidate.kind === "veil-reproduction");
  const reproductionTask =
    reproductionReceipt === undefined
      ? latestProjectedReproductionTask
      : promotionStream.projection.tasks.find(
          (candidate) => candidate.id === reproductionReceipt.taskId,
        );
  const reproductionAwaitingStream =
    reproductionReceipt !== undefined && reproductionTask === undefined;
  const activeTab = projection.activeView?.kind === "backtest" ? "Backtest" : "Explore";
  const canPromote =
    DEMO_STREAM_ENABLED &&
    sessionProfileId === "raw-pi" &&
    projection.activeView !== undefined &&
    projection.status === "ready" &&
    veilReady &&
    artifactReference.trim().length > 0 &&
    hypothesisStatement.trim().length > 0 &&
    promotionReceipt === undefined &&
    !promotionPending;

  async function startPromotion() {
    const view = projection.activeView;
    if (view === undefined || !canPromote) return;
    setPromotionPending(true);
    setPromotionError(undefined);
    try {
      const receipt = await createVeilPromotion({
        daemonOrigin: DAEMON_ORIGIN,
        projectId: DEMO_PROJECT_ID,
        sourceSessionId: DEMO_SESSION_ID,
        viewId: view.viewId,
        artifactReference: artifactReference.trim(),
        hypothesisStatement: hypothesisStatement.trim(),
      });
      setPromotionReceipt(receipt);
      setDismissedExperimentId(undefined);
    } catch (error) {
      setPromotionError(
        error instanceof Error ? error.message : "The verification attempt could not start.",
      );
    } finally {
      setPromotionPending(false);
    }
  }

  async function cancelPromotion() {
    if (promotionReceipt === undefined || cancelPending) return;
    setCancelPending(true);
    setPromotionError(undefined);
    try {
      await cancelVeilPromotion({
        daemonOrigin: DAEMON_ORIGIN,
        projectId: DEMO_PROJECT_ID,
        sessionId: promotionReceipt.sessionId,
        taskId: promotionReceipt.taskId,
      });
    } catch (error) {
      setPromotionError(
        error instanceof Error ? error.message : "The verification task could not be cancelled.",
      );
    } finally {
      setCancelPending(false);
    }
  }

  async function startReproduction() {
    if (promotionReceipt === undefined || experiment === undefined || reproductionPending) return;
    setReproductionPending(true);
    setPromotionError(undefined);
    try {
      const receipt = await reproduceVeilExperiment({
        daemonOrigin: DAEMON_ORIGIN,
        projectId: DEMO_PROJECT_ID,
        sessionId: promotionReceipt.sessionId,
        experimentId: experiment.experimentId,
        attemptId: promotionReceipt.attemptId,
      });
      setReproductionReceipt(receipt);
    } catch (error) {
      setPromotionError(
        error instanceof Error ? error.message : "The Experiment could not be reproduced.",
      );
    } finally {
      setReproductionPending(false);
    }
  }

  async function cancelReproduction() {
    if (promotionReceipt === undefined || reproductionTask === undefined || cancelPending) return;
    setCancelPending(true);
    setPromotionError(undefined);
    try {
      await cancelVeilPromotion({
        daemonOrigin: DAEMON_ORIGIN,
        projectId: DEMO_PROJECT_ID,
        sessionId: promotionReceipt.sessionId,
        taskId: reproductionTask.id,
      });
    } catch (error) {
      setPromotionError(
        error instanceof Error ? error.message : "The reproduction task could not be cancelled.",
      );
    } finally {
      setCancelPending(false);
    }
  }

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
          <VeilReadiness state={projectReadiness} />
        </div>
        <div className="inline-flex rounded-xl border border-[var(--border)] bg-black/20 p-1">
          {LOOM_PROFILE_DESCRIPTORS.map((descriptor) => (
            <button
              aria-pressed={sessionProfileId === descriptor.id}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                sessionProfileId === descriptor.id
                  ? "bg-slate-100 text-slate-950"
                  : "text-[var(--muted)] hover:text-white"
              } ${
                sessionFrozen || (descriptor.id === "veil" && !veilReady)
                  ? "cursor-not-allowed opacity-60"
                  : ""
              }`}
              disabled={sessionFrozen || (descriptor.id === "veil" && !veilReady)}
              key={descriptor.id}
              onClick={() => setProfileId(descriptor.id)}
              title={
                descriptor.id === "veil" && !veilReady
                  ? "Veil requires a ready project reported by the local daemon"
                  : undefined
              }
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
                Select a chart interval to ask Pi with grounded context.
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

          <CanvasContent
            activeSelection={projection.activeSelection}
            daemonOrigin={DAEMON_ORIGIN}
            projectId={DEMO_PROJECT_ID}
            sessionId={DEMO_SESSION_ID}
            state={backtestView}
          />

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

      <PromotionPanel
        artifactReference={artifactReference}
        canPromote={canPromote}
        cancelPending={cancelPending}
        connection={promotionStream.connection}
        evidence={evidence}
        error={promotionError}
        hypothesisStatement={hypothesisStatement}
        onArtifactReference={setArtifactReference}
        onCancel={() => void cancelPromotion()}
        onCancelReproduction={() => void cancelReproduction()}
        onHypothesisStatement={setHypothesisStatement}
        onReset={() => {
          setDismissedExperimentId(experiment?.experimentId);
          setPromotionReceipt(undefined);
          setReproductionReceipt(undefined);
          setPromotionError(undefined);
        }}
        onReproduce={() => void startReproduction()}
        onStart={() => void startPromotion()}
        pending={promotionPending}
        projection={promotionStream.projection}
        receipt={promotionReceipt}
        reproductionAwaitingStream={reproductionAwaitingStream}
        reproductionPending={reproductionPending}
        reproductionTask={reproductionTask}
      />
    </main>
  );
}

function PromotionPanel({
  artifactReference,
  canPromote,
  cancelPending,
  connection,
  evidence,
  error,
  hypothesisStatement,
  onArtifactReference,
  onCancel,
  onCancelReproduction,
  onHypothesisStatement,
  onReset,
  onReproduce,
  onStart,
  pending,
  projection,
  receipt,
  reproductionAwaitingStream,
  reproductionPending,
  reproductionTask,
}: Readonly<{
  artifactReference: string;
  canPromote: boolean;
  cancelPending: boolean;
  connection: BrowserConnectionState;
  evidence: ExperimentEvidenceState;
  error: string | undefined;
  hypothesisStatement: string;
  onArtifactReference: (value: string) => void;
  onCancel: () => void;
  onCancelReproduction: () => void;
  onHypothesisStatement: (value: string) => void;
  onReset: () => void;
  onReproduce: () => void;
  onStart: () => void;
  pending: boolean;
  projection: SessionProjection;
  receipt: LoomPromotionAcceptedResponse | undefined;
  reproductionAwaitingStream: boolean;
  reproductionPending: boolean;
  reproductionTask: TaskProjection | undefined;
}>) {
  const task =
    receipt === undefined
      ? undefined
      : projection.tasks.find((candidate) => candidate.id === receipt.taskId);
  const terminal =
    task !== undefined && ["cancelled", "completed", "failed", "interrupted"].includes(task.status);
  const experiment = projection.veilAttempt?.experiment;
  const canCancel = task?.status === "running" && !cancelPending;
  const reproductionRunning =
    reproductionPending ||
    reproductionAwaitingStream ||
    reproductionTask?.status === "running" ||
    reproductionTask?.status === "cancel-requested";
  const latestReproduction = projection.veilAttempt?.reproductions.at(-1);

  return (
    <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)]/90 p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
            Promote with Veil
          </p>
          <h2 className="mt-1 text-base font-semibold">Start a new verification attempt</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Loom carries only the hypothesis and selected artifact identity. Veil rereads registered
            data and re-executes independently; Raw metrics are never a target or gate input.
          </p>
        </div>
        <span className="rounded-full border border-lime-200/15 bg-[var(--accent-soft)] px-3 py-1.5 text-[10px] font-semibold text-[var(--accent)]">
          DERIVED FROM EXPLORATION
        </span>
      </div>

      {receipt === undefined ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(320px,1.3fr)_auto] lg:items-end">
          <label className="grid gap-1.5 text-xs text-slate-300">
            Project-relative artifact
            <input
              autoComplete="off"
              className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-lime-200/40"
              disabled={pending}
              maxLength={256}
              onChange={(event) => onArtifactReference(event.target.value)}
              spellCheck={false}
              value={artifactReference}
            />
          </label>
          <label className="grid gap-1.5 text-xs text-slate-300">
            Hypothesis
            <input
              autoComplete="off"
              className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-lime-200/40"
              disabled={pending}
              maxLength={4096}
              onChange={(event) => onHypothesisStatement(event.target.value)}
              value={hypothesisStatement}
            />
          </label>
          <button
            className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-[#17200e] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canPromote}
            onClick={onStart}
            type="button"
          >
            {pending ? "Starting…" : "Promote with Veil"}
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/20 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-200">
                Raw session → independent Veil attempt
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                {receipt.attemptId} · {projection.veilAttempt?.stage?.stage ?? "starting"}
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {streamDescription(connection, projection.issue?.message)}
              </p>
            </div>
            <div className="flex gap-2">
              {canCancel ? (
                <button
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
                  disabled={cancelPending}
                  onClick={onCancel}
                  type="button"
                >
                  {cancelPending ? "Cancelling…" : "Cancel"}
                </button>
              ) : null}
              {terminal && !reproductionRunning ? (
                <button
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-slate-300"
                  onClick={onReset}
                  type="button"
                >
                  New attempt
                </button>
              ) : null}
            </div>
          </div>

          {experiment === undefined ? (
            <p className="mt-3 text-xs font-semibold text-[var(--warning)]">
              {task?.status === "failed"
                ? "EXECUTION FAILED · NO REJECTED EXPERIMENT WAS INFERRED"
                : task?.status === "cancelled" || task?.status === "interrupted"
                  ? `${task.status.toUpperCase()} · NO EXPERIMENT CLAIM`
                  : "VERIFYING · SOURCE RESULT REMAINS EXPLORATORY"}
            </p>
          ) : (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <p
                className={`text-xs font-semibold tracking-wide ${
                  experiment.verdict === "accepted"
                    ? "text-[var(--accent)]"
                    : experiment.verdict === "degraded"
                      ? "text-[var(--warning)]"
                      : "text-red-300"
                }`}
              >
                VEIL EXPERIMENT · {experiment.verdict.toUpperCase()}
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-500">
                {experiment.experimentId} · {experiment.executionCount} isolated executions
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                This assurance belongs to the new attempt only. The source chart remains
                exploratory.
              </p>
              <ExperimentEvidence
                cancelPending={cancelPending}
                evidence={evidence}
                latestReproduction={latestReproduction}
                onCancel={onCancelReproduction}
                onReproduce={onReproduce}
                reproductionPending={reproductionPending}
                reproductionTask={reproductionTask}
              />
            </div>
          )}
        </div>
      )}
      {error === undefined ? null : (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ExperimentEvidence({
  cancelPending,
  evidence,
  latestReproduction,
  onCancel,
  onReproduce,
  reproductionPending,
  reproductionTask,
}: Readonly<{
  cancelPending: boolean;
  evidence: ExperimentEvidenceState;
  latestReproduction:
    | NonNullable<SessionProjection["veilAttempt"]>["reproductions"][number]
    | undefined;
  onCancel: () => void;
  onReproduce: () => void;
  reproductionPending: boolean;
  reproductionTask: TaskProjection | undefined;
}>) {
  if (evidence.status === "disabled" || evidence.status === "loading") {
    return <p className="mt-4 text-xs text-[var(--muted)]">Loading verified evidence…</p>;
  }
  if (evidence.status === "error") {
    return (
      <p className="mt-4 text-xs text-red-300" role="alert">
        {evidence.message}
      </p>
    );
  }

  const record = evidence.evidence;
  const reproductionRunning =
    reproductionPending ||
    reproductionTask?.status === "running" ||
    reproductionTask?.status === "cancel-requested";
  return (
    <div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <EvidenceFact label="Dataset" value={`${record.dataset.id} · ${record.dataset.version}`} />
        <EvidenceFact
          label="Pricing method"
          value={`${record.pricingMethod.id} · ${record.pricingMethod.version}`}
        />
        <EvidenceFact
          label="OOS sample"
          value={`${record.sample.observations} observations · ${record.sample.periodsPerYear}/year`}
        />
        <EvidenceFact label="Effective trials" value={String(record.effectiveTrials)} />
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Verified metrics
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {record.metrics.map((metric) => (
            <div
              className="rounded-lg border border-[var(--border)] px-3 py-2"
              key={`${metric.scope}\0${metric.basis}\0${metric.name}\0${metric.unit}`}
            >
              <p className="text-[10px] text-slate-500">{metric.name}</p>
              <p className="mt-1 font-mono text-xs text-slate-200">
                {formatEvidenceValue(metric.value)} {metric.unit}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                {metric.basis} · {metric.scope}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Gate review
        </p>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          {record.gates.map((gate) => (
            <div
              className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
              key={gate.gateId}
            >
              <div>
                <p className="text-xs text-slate-200">{gate.gateId}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-500">{gate.reasonCode}</p>
              </div>
              <span
                className={`text-[10px] font-semibold uppercase ${
                  gate.outcome === "passed"
                    ? "text-[var(--accent)]"
                    : gate.outcome === "unavailable"
                      ? "text-[var(--warning)]"
                      : "text-red-300"
                }`}
              >
                {gate.outcome}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-black/15 p-3">
        <p className="text-xs text-slate-300">{record.rationale}</p>
        {keyedLessons(record.lessons.items).map((lesson) => (
          <p className="mt-2 text-xs text-[var(--muted)]" key={lesson.key}>
            {lesson.text}
          </p>
        ))}
        {record.lessons.truncated ? (
          <p className="mt-2 text-[10px] text-slate-500">
            Showing {record.lessons.items.length} of {record.lessons.totalCount} archived lessons.
          </p>
        ) : null}
      </div>

      <details className="rounded-lg border border-[var(--border)] px-3 py-2 text-[10px] text-slate-500">
        <summary className="cursor-pointer text-xs text-slate-300">Evidence identities</summary>
        <div className="mt-2 grid gap-1 font-mono">
          <span>archive {record.archiveHash}</span>
          <span>artifact {record.lineage.artifactHash}</span>
          <span>contract {record.lineage.contractHash}</span>
          <span>pricing {record.lineage.pricingHash}</span>
          <span>gates {record.lineage.gateEvaluationHash}</span>
          <span>{record.lineage.readSetSnapshotCount} immutable read-set snapshots</span>
        </div>
      </details>

      <div className="flex flex-col gap-3 rounded-lg border border-lime-200/15 bg-[var(--accent-soft)]/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-200">Exact reproduction</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {latestReproduction !== undefined
              ? "Matched artifact, snapshot, pricing, metric, and gate identities. The original verdict is unchanged."
              : reproductionTask?.status === "failed"
                ? "Reproduction failed; no matched identity was inferred."
                : reproductionTask?.status === "cancelled" ||
                    reproductionTask?.status === "interrupted"
                  ? `${reproductionTask.status} · no reproduction claim`
                  : reproductionRunning
                    ? "Re-executing the archived artifact from immutable snapshots…"
                    : "Re-run the archived artifact, pricing, and gates without contacting a model."}
          </p>
          {latestReproduction === undefined ? null : (
            <p className="mt-1 font-mono text-[10px] text-slate-500">
              {latestReproduction.reproductionHash}
            </p>
          )}
        </div>
        {reproductionRunning ? (
          <button
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
            disabled={cancelPending || reproductionTask?.status !== "running"}
            onClick={onCancel}
            type="button"
          >
            {cancelPending ? "Cancelling…" : "Cancel reproduction"}
          </button>
        ) : (
          <button
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[#17200e]"
            onClick={onReproduce}
            type="button"
          >
            {latestReproduction === undefined ? "Reproduce Experiment" : "Reproduce again"}
          </button>
        )}
      </div>
    </div>
  );
}

function EvidenceFact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="mt-1 text-xs text-slate-200">{value}</p>
    </div>
  );
}

function formatEvidenceValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toPrecision(6).replace(/\.?0+$/u, "");
}

function keyedLessons(items: readonly string[]): readonly { key: string; text: string }[] {
  const occurrences = new Map<string, number>();
  return items.map((text) => {
    const occurrence = (occurrences.get(text) ?? 0) + 1;
    occurrences.set(text, occurrence);
    return { key: `${text}\0${occurrence}`, text };
  });
}

function VeilReadiness({ state }: Readonly<{ state: ProjectReadinessState }>) {
  if (state.status === "ready") {
    const project = state.readiness.project;
    if (project === undefined) return null;
    return (
      <p className="mt-2 text-xs text-[var(--accent)]">
        Veil {state.readiness.runtime.installedVersion} ready · {project.datasetCount}{" "}
        {project.datasetCount === 1 ? "dataset" : "datasets"} · {project.runtimeCount}{" "}
        {project.runtimeCount === 1 ? "runtime" : "runtimes"}. Ready for a new verification attempt.
      </p>
    );
  }
  if (state.status === "invalid" || state.status === "unavailable") {
    return (
      <p className="mt-2 text-xs text-[var(--warning)]">
        Veil is not ready: {state.readiness.issue?.message ?? "check the project setup."}
      </p>
    );
  }
  const message = {
    disabled: "Run the local daemon to check Veil project readiness.",
    loading: "Checking Veil project readiness…",
    failed: state.status === "failed" ? state.message : "Project readiness could not load.",
  }[state.status];
  return <p className="mt-2 text-xs text-[var(--muted)]">{message}</p>;
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

function CanvasContent({
  state,
  activeSelection,
  daemonOrigin,
  projectId,
  sessionId,
}: Readonly<{
  state: BacktestViewState;
  activeSelection: LoomSelection | undefined;
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
}>) {
  if (state.status === "ready") {
    return (
      <BacktestCanvas
        activeSelection={activeSelection}
        daemonOrigin={daemonOrigin}
        key={state.resources.view.viewId}
        projectId={projectId}
        resources={state.resources}
        sessionId={sessionId}
      />
    );
  }
  const message = {
    waiting: "Waiting for a validated backtest view…",
    loading: "Loading content-addressed chart resources…",
    failed: state.status === "failed" ? state.message : "The view could not load.",
  }[state.status];
  return (
    <div className="grid flex-1 place-items-center p-5">
      <div className="max-w-md rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
        <p className="text-sm font-semibold text-slate-300">Backtest canvas</p>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{message}</p>
      </div>
    </div>
  );
}
