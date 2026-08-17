"use client";

import {
  compareLoomTime,
  type LoomMetric,
  type LoomOhlcvPoint,
  type LoomScalarPoint,
  type LoomSelection,
  type LoomSelectionSeriesKey,
  type LoomTime,
  type LoomTradeRow,
} from "@veilquant/loom-protocol";
import {
  type PointerEventHandler,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  type WheelEventHandler,
} from "react";
import type { BacktestViewResources } from "../lib/backtest-view";
import { scaleChartValues, svgAreaPath, svgLinePath } from "../lib/chart-geometry";
import { createSelectionContext, sendSelectionQuestion } from "../lib/selection-client";
import {
  applyViewportUpdate,
  createViewportState,
  type LoomTimeRange,
  orderedRange,
  panViewport,
  sameRange,
  timesInRange,
  type ViewportSource,
  type ViewportState,
  zoomViewport,
} from "../lib/viewport-controller";

const CHART_WIDTH = 760;
const CHART_HEIGHT = 210;
const CHART_PADDING = 18;
const SELECTION_QUESTION =
  "Explain what happened in this selected interval, especially the drawdown and executions.";

interface BacktestCanvasProps {
  resources: BacktestViewResources;
  activeSelection: LoomSelection | undefined;
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
}

type ActionState =
  | { status: "idle" }
  | { status: "creating" | "waiting" | "asking" | "submitted" }
  | { status: "failed"; message: string };

interface ChartInteractions {
  onPointerDown: PointerEventHandler<SVGSVGElement>;
  onPointerMove: PointerEventHandler<SVGSVGElement>;
  onPointerUp: PointerEventHandler<SVGSVGElement>;
  onPointerCancel: PointerEventHandler<SVGSVGElement>;
  onPointerLeave: PointerEventHandler<SVGSVGElement>;
  onWheel: WheelEventHandler<SVGSVGElement>;
}

export function BacktestCanvas({
  resources,
  activeSelection,
  daemonOrigin,
  projectId,
  sessionId,
}: Readonly<BacktestCanvasProps>) {
  const { view } = resources;
  const timeline = (resources.market?.points ?? resources.equity.points).map((point) => point.time);
  const [viewport, setViewport] = useState(() =>
    initialViewport(
      timeline,
      activeSelection?.viewId === view.viewId ? activeSelection : undefined,
    ),
  );
  const [acceptedSelectionId, setAcceptedSelectionId] = useState<string | undefined>(() =>
    activeSelection?.viewId === view.viewId ? activeSelection.selectionId : undefined,
  );
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const originNumber = useRef(0);
  const dragAnchor = useRef<LoomTime | undefined>(undefined);
  const restoredSelection = useRef(activeSelection !== undefined);
  const visibleTimes = timesInRange(timeline, viewport.visible);
  const selectionTimes =
    viewport.selection === undefined ? [] : timesInRange(timeline, viewport.selection);
  const durableSelection =
    activeSelection !== undefined &&
    activeSelection.viewId === view.viewId &&
    activeSelection.selectionId === acceptedSelectionId &&
    viewport.selection !== undefined &&
    sameRange(activeSelection, viewport.selection);

  useEffect(() => {
    if (
      restoredSelection.current ||
      activeSelection === undefined ||
      activeSelection.viewId !== view.viewId ||
      viewport.selection !== undefined
    ) {
      return;
    }
    restoredSelection.current = true;
    setAcceptedSelectionId(activeSelection.selectionId);
    setViewport(
      (current) =>
        applyViewportUpdate(current, {
          originId: "selection-replay",
          source: "controls",
          selection: { from: activeSelection.from, until: activeSelection.until },
        }).state,
    );
  }, [activeSelection, view.viewId, viewport.selection]);

  useEffect(() => {
    if (durableSelection && action.status === "waiting") setAction({ status: "idle" });
  }, [action.status, durableSelection]);

  function updateViewport(
    source: ViewportSource,
    update: Omit<Parameters<typeof applyViewportUpdate>[1], "originId" | "source">,
  ) {
    const originId = `${source}-${++originNumber.current}`;
    setViewport((current) => applyViewportUpdate(current, { ...update, originId, source }).state);
  }

  function selectRange(range: LoomTimeRange) {
    setAcceptedSelectionId(undefined);
    setAction({ status: "idle" });
    updateViewport("controls", { selection: range });
  }

  function interactions(source: "market" | "equity"): ChartInteractions {
    const timeAtPointer = (event: { clientX: number; currentTarget: SVGSVGElement }) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const coordinate = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * CHART_WIDTH;
      const ratio = Math.max(
        0,
        Math.min(1, (coordinate - CHART_PADDING) / (CHART_WIDTH - CHART_PADDING * 2)),
      );
      return visibleTimes[Math.round(ratio * Math.max(0, visibleTimes.length - 1))];
    };
    const finishDrag: PointerEventHandler<SVGSVGElement> = (event) => {
      if (dragAnchor.current !== undefined) {
        const time = timeAtPointer(event);
        if (time !== undefined) selectRange(orderedRange(dragAnchor.current, time));
      }
      dragAnchor.current = undefined;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };
    return {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        const time = timeAtPointer(event);
        if (time === undefined) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragAnchor.current = time;
        selectRange({ from: time, until: time });
      },
      onPointerMove: (event) => {
        const time = timeAtPointer(event);
        if (time === undefined) return;
        updateViewport(source, {
          crosshair: time,
          ...(dragAnchor.current === undefined
            ? {}
            : { selection: orderedRange(dragAnchor.current, time) }),
        });
      },
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onPointerLeave: () => {
        if (dragAnchor.current === undefined) updateViewport(source, { crosshair: null });
      },
      onWheel: (event) => {
        event.preventDefault();
        const anchor = timeAtPointer(event) ?? visibleTimes[Math.floor(visibleTimes.length / 2)];
        if (anchor === undefined) return;
        const pan = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
        const next = pan
          ? panViewport(
              timeline,
              viewport.visible,
              Math.sign(event.deltaX || event.deltaY) *
                Math.max(1, Math.round(visibleTimes.length / 8)),
            )
          : zoomViewport(timeline, viewport.visible, event.deltaY > 0 ? 1.35 : 0.75, anchor);
        updateViewport(source, {
          visible: next,
          seriesResolution: timesInRange(timeline, next).length,
        });
      },
    };
  }

  function zoom(factor: number) {
    const anchor = viewport.crosshair ?? visibleTimes[Math.floor(visibleTimes.length / 2)];
    if (anchor === undefined) return;
    const visible = zoomViewport(timeline, viewport.visible, factor, anchor);
    updateViewport("controls", {
      visible,
      seriesResolution: timesInRange(timeline, visible).length,
    });
  }

  function pan(steps: number) {
    const visible = panViewport(timeline, viewport.visible, steps);
    updateViewport("controls", {
      visible,
      seriesResolution: timesInRange(timeline, visible).length,
    });
  }

  async function createSelection() {
    if (viewport.selection === undefined || selectionTimes.length < 2) return;
    setAction({ status: "creating" });
    try {
      const selectionId = await createSelectionContext({
        daemonOrigin,
        projectId,
        sessionId,
        viewId: view.viewId,
        from: viewport.selection.from,
        until: viewport.selection.until,
        seriesKeys: visibleSeriesKeys(resources),
      });
      setAcceptedSelectionId(selectionId);
      setAction({ status: "waiting" });
    } catch (error) {
      setAction({
        status: "failed",
        message: error instanceof Error ? error.message : "The selection could not be created",
      });
    }
  }

  async function askPi() {
    if (!durableSelection) return;
    setAction({ status: "asking" });
    try {
      await sendSelectionQuestion({
        daemonOrigin,
        projectId,
        sessionId,
        selectionId: activeSelection.selectionId,
        content: SELECTION_QUESTION,
      });
      setAction({ status: "submitted" });
    } catch (error) {
      setAction({
        status: "failed",
        message: error instanceof Error ? error.message : "Pi could not review the selection",
      });
    }
  }

  const drawdownRegion = view.regions.find((region) => region.kind === "drawdown");
  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <section className="rounded-xl border border-amber-300/20 bg-amber-300/8 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-[var(--warning)]">
              EXPLORATORY · UNVERIFIED
            </p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">{view.summary}</p>
          </div>
          <span className="rounded-md border border-[var(--border)] bg-black/20 px-2 py-1 font-mono text-[10px] text-slate-400">
            {view.provenance.run.equityBasis.toUpperCase()} · {view.provenance.run.protocolId}
          </span>
        </div>
      </section>

      <ViewportControls
        onDrawdown={
          drawdownRegion === undefined
            ? undefined
            : () => selectRange({ from: drawdownRegion.start, until: drawdownRegion.end })
        }
        onPan={pan}
        onReset={() =>
          updateViewport("controls", {
            visible: viewport.domain,
            seriesResolution: timeline.length,
          })
        }
        onZoom={zoom}
        viewport={viewport}
      />
      <MarketChart
        interactions={interactions("market")}
        market={resources.market?.points ?? []}
        timeline={timeline}
        trades={resources.trades?.rows ?? []}
        viewport={viewport}
      />
      <EquityChart
        drawdown={resources.drawdown?.points ?? []}
        equity={resources.equity.points}
        interactions={interactions("equity")}
        timeline={timeline}
        viewport={viewport}
      />
      <SelectionPanel
        action={action}
        activeSelection={durableSelection ? activeSelection : undefined}
        canCreate={viewport.selection !== undefined && selectionTimes.length >= 2}
        onAsk={() => void askPi()}
        onClear={() => {
          setAcceptedSelectionId(undefined);
          setAction({ status: "idle" });
          updateViewport("controls", { selection: null });
        }}
        onCreate={() => void createSelection()}
        range={viewport.selection}
        sessions={selectionTimes.length}
      />

      <section aria-label="Backtest metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {view.metrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} />
        ))}
      </section>

      <details className="rounded-xl border border-[var(--border)] bg-black/15 px-4 py-3 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-300">
          Data and provenance
        </summary>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-slate-400">
              <caption className="mb-2 text-left font-semibold text-slate-300">
                Market series fallback
              </caption>
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Date", "Open", "High", "Low", "Close"].map((heading) => (
                    <th className="px-2 py-2 font-medium" key={heading}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(resources.market?.points ?? []).map((point) => (
                  <tr className="border-b border-[var(--border)]/50" key={point.time.epoch}>
                    <td className="px-2 py-2">{formatTime(point.time)}</td>
                    <td className="px-2 py-2">{point.open.toFixed(2)}</td>
                    <td className="px-2 py-2">{point.high.toFixed(2)}</td>
                    <td className="px-2 py-2">{point.low.toFixed(2)}</td>
                    <td className="px-2 py-2">{point.close.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid content-start gap-2 text-[11px] text-slate-400">
            <ProvenanceRow
              label="Adapter"
              value={`${view.provenance.adapter.id}@${view.provenance.adapter.version}`}
            />
            <ProvenanceRow
              label="Data"
              value={`${view.provenance.source.dataId} · ${view.provenance.source.dataDigest}`}
            />
            <ProvenanceRow
              label="Artifact"
              value={`${view.provenance.source.artifactId} · ${view.provenance.source.artifactDigest}`}
            />
            <ProvenanceRow label="Cost model" value={view.provenance.run.costModel} />
            <ProvenanceRow label="View ID" value={view.viewId} />
          </dl>
        </div>
      </details>
    </div>
  );
}

function ViewportControls({
  viewport,
  onZoom,
  onPan,
  onReset,
  onDrawdown,
}: Readonly<{
  viewport: ViewportState;
  onZoom: (factor: number) => void;
  onPan: (steps: number) => void;
  onReset: () => void;
  onDrawdown: (() => void) | undefined;
}>) {
  const buttons = [
    ["Pan left", () => onPan(-1)],
    ["Zoom in", () => onZoom(0.75)],
    ["Zoom out", () => onZoom(1.35)],
    ["Pan right", () => onPan(1)],
    ["Reset", onReset],
  ] as const;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-black/15 px-4 py-3">
      <div>
        <p className="text-xs font-semibold text-slate-300">Synchronized viewport</p>
        <p className="mt-1 font-mono text-[10px] text-slate-500">
          {formatTime(viewport.visible.from)} → {formatTime(viewport.visible.until)} ·{" "}
          {viewport.seriesResolution} points
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {onDrawdown === undefined ? null : (
          <ControlButton label="Select max drawdown" onClick={onDrawdown} />
        )}
        {buttons.map(([label, handler]) => (
          <ControlButton key={label} label={label} onClick={handler} />
        ))}
      </div>
    </div>
  );
}

function ControlButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button
      className="rounded-md border border-[var(--border)] bg-[var(--panel-soft)] px-2.5 py-1.5 text-[10px] font-medium text-slate-400 hover:text-slate-100"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function MarketChart({
  market,
  trades,
  timeline,
  viewport,
  interactions,
}: Readonly<{
  market: readonly LoomOhlcvPoint[];
  trades: readonly LoomTradeRow[];
  timeline: readonly LoomTime[];
  viewport: ViewportState;
  interactions: ChartInteractions;
}>) {
  const visible = filterTimed(market, viewport.visible);
  if (visible.length === 0) return <EmptyChart label="Market and trades" />;
  const visibleTrades = filterTimed(trades, viewport.visible);
  const priceScale = scaleChartValues(
    visible.flatMap((point) => [point.low, point.high]),
    CHART_WIDTH,
    CHART_HEIGHT,
    CHART_PADDING,
  );
  const span = priceScale.maximum - priceScale.minimum || 1;
  const xFor = (index: number) =>
    CHART_PADDING + (index / Math.max(1, visible.length - 1)) * (CHART_WIDTH - CHART_PADDING * 2);
  const yFor = (value: number) =>
    CHART_PADDING + ((priceScale.maximum - value) / span) * (CHART_HEIGHT - CHART_PADDING * 2);
  const indexByEpoch = new Map(visible.map((point, index) => [point.time.epoch, index]));
  return (
    <ChartFrame
      detail={`${visible.length} visible sessions · ${visibleTrades.length} executions`}
      label="Market and trades"
    >
      <svg
        {...interactions}
        aria-label="Interactive daily OHLC market chart with synchronized selection"
        className="h-52 w-full cursor-crosshair touch-none select-none"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <title>Daily OHLC market chart with normalized execution markers</title>
        {visible.map((point, index) => {
          const x = xFor(index);
          const open = yFor(point.open);
          const close = yFor(point.close);
          const rising = point.close >= point.open;
          return (
            <g key={point.time.epoch}>
              <line
                opacity="0.8"
                stroke={rising ? "var(--accent)" : "#f59e8b"}
                strokeWidth="1.5"
                x1={x}
                x2={x}
                y1={yFor(point.high)}
                y2={yFor(point.low)}
              />
              <rect
                fill={rising ? "var(--accent)" : "#f59e8b"}
                height={Math.max(2, Math.abs(close - open))}
                opacity="0.75"
                width={Math.max(5, CHART_WIDTH / visible.length / 3)}
                x={x - Math.max(5, CHART_WIDTH / visible.length / 3) / 2}
                y={Math.min(open, close)}
              />
            </g>
          );
        })}
        {visibleTrades.map((trade) => {
          const index = indexByEpoch.get(trade.time.epoch);
          if (index === undefined) return null;
          const x = xFor(index);
          const y = yFor(trade.price) + (trade.side === "buy" ? 14 : -10);
          return (
            <g key={trade.tradeId}>
              <circle
                cx={x}
                cy={y}
                fill={trade.side === "buy" ? "#60a5fa" : "#f5bd68"}
                r="7"
                stroke="#090b0f"
                strokeWidth="2"
              />
              <text
                fill="#090b0f"
                fontSize="7"
                fontWeight="700"
                textAnchor="middle"
                x={x}
                y={y + 2.5}
              >
                {trade.side === "buy" ? "B" : "S"}
              </text>
            </g>
          );
        })}
        <ViewportOverlay timeline={timeline} viewport={viewport} />
      </svg>
    </ChartFrame>
  );
}

function EquityChart({
  equity,
  drawdown,
  timeline,
  viewport,
  interactions,
}: Readonly<{
  equity: readonly LoomScalarPoint[];
  drawdown: readonly LoomScalarPoint[];
  timeline: readonly LoomTime[];
  viewport: ViewportState;
  interactions: ChartInteractions;
}>) {
  const visibleEquity = filterTimed(equity, viewport.visible);
  if (visibleEquity.length === 0) return <EmptyChart label="Net equity and drawdown" />;
  const visibleDrawdown = filterTimed(drawdown, viewport.visible);
  const equityValues = visibleEquity.map((point) => point.value);
  const drawdownValues =
    visibleDrawdown.length === visibleEquity.length
      ? visibleDrawdown.map((point) => point.value)
      : equityValues.map(() => 0);
  const equityScale = scaleChartValues(equityValues, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);
  const drawdownScale = scaleChartValues(drawdownValues, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);
  return (
    <ChartFrame
      detail={`${formatCurrency(equityValues[0] ?? 0)} → ${formatCurrency(equityValues.at(-1) ?? 0)}`}
      label="Net equity and drawdown"
    >
      <svg
        {...interactions}
        aria-label="Interactive net equity curve with synchronized selection"
        className="h-52 w-full cursor-crosshair touch-none select-none"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <title>Net equity curve with drawdown area</title>
        <path
          d={svgAreaPath(drawdownScale.points, CHART_HEIGHT - CHART_PADDING)}
          fill="#f59e8b"
          opacity="0.12"
        />
        <path
          d={svgLinePath(drawdownScale.points)}
          fill="none"
          opacity="0.55"
          stroke="#f59e8b"
          strokeWidth="1.5"
        />
        <path
          d={svgLinePath(equityScale.points)}
          fill="none"
          stroke="var(--accent)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <ViewportOverlay timeline={timeline} viewport={viewport} />
      </svg>
    </ChartFrame>
  );
}

function ViewportOverlay({
  timeline,
  viewport,
}: Readonly<{ timeline: readonly LoomTime[]; viewport: ViewportState }>) {
  const visible = timesInRange(timeline, viewport.visible);
  const xFor = (time: LoomTime) => {
    const index = visible.findIndex((candidate) => sameTime(candidate, time));
    return index < 0
      ? undefined
      : CHART_PADDING +
          (index / Math.max(1, visible.length - 1)) * (CHART_WIDTH - CHART_PADDING * 2);
  };
  const selected =
    viewport.selection === undefined ? [] : timesInRange(visible, viewport.selection);
  const firstX = selected[0] === undefined ? undefined : xFor(selected[0]);
  const lastSelected = selected.at(-1);
  const lastX = lastSelected === undefined ? undefined : xFor(lastSelected);
  const crosshairX = viewport.crosshair === undefined ? undefined : xFor(viewport.crosshair);
  return (
    <g pointerEvents="none">
      {firstX === undefined || lastX === undefined ? null : (
        <rect
          fill="#60a5fa"
          height={CHART_HEIGHT - CHART_PADDING * 2}
          opacity="0.13"
          rx="3"
          width={Math.max(4, lastX - firstX)}
          x={Math.min(firstX, lastX) - (firstX === lastX ? 2 : 0)}
          y={CHART_PADDING}
        />
      )}
      {crosshairX === undefined ? null : (
        <line
          opacity="0.65"
          stroke="#cbd5e1"
          strokeDasharray="3 3"
          strokeWidth="1"
          x1={crosshairX}
          x2={crosshairX}
          y1={CHART_PADDING}
          y2={CHART_HEIGHT - CHART_PADDING}
        />
      )}
    </g>
  );
}

function SelectionPanel({
  range,
  sessions,
  activeSelection,
  action,
  canCreate,
  onCreate,
  onAsk,
  onClear,
}: Readonly<{
  range: LoomTimeRange | undefined;
  sessions: number;
  activeSelection: LoomSelection | undefined;
  action: ActionState;
  canCreate: boolean;
  onCreate: () => void;
  onAsk: () => void;
  onClear: () => void;
}>) {
  return (
    <section
      aria-label="Selection context"
      className="rounded-xl border border-blue-300/15 bg-blue-300/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-300">Selection context</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {range === undefined
              ? "Drag either chart, or choose the maximum-drawdown range."
              : `${formatTime(range.from)} → ${formatTime(range.until)} · ${sessions} sessions`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {range === undefined ? null : <ControlButton label="Clear" onClick={onClear} />}
          <button
            className="rounded-md bg-blue-200 px-3 py-1.5 text-[10px] font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canCreate || action.status === "creating" || action.status === "waiting"}
            onClick={onCreate}
            type="button"
          >
            {action.status === "creating" || action.status === "waiting"
              ? "Creating context…"
              : "Create selection context"}
          </button>
          <button
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[10px] font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={activeSelection === undefined || action.status === "asking"}
            onClick={onAsk}
            type="button"
          >
            {action.status === "asking" ? "Asking Pi…" : "Ask Pi about selection"}
          </button>
        </div>
      </div>
      {activeSelection === undefined ? null : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {activeSelection.visibleSummary.map((metric) => (
            <div
              className="rounded-lg border border-blue-200/10 bg-black/15 px-3 py-2"
              key={metric.key}
            >
              <p className="text-[9px] uppercase tracking-wider text-slate-500">{metric.label}</p>
              <p className="mt-1 text-sm font-semibold text-slate-200">{formatMetric(metric)}</p>
            </div>
          ))}
        </div>
      )}
      {action.status === "failed" ? (
        <p className="mt-3 text-[11px] text-red-300">{action.message}</p>
      ) : action.status === "submitted" ? (
        <p className="mt-3 text-[11px] text-[var(--accent)]">
          Pi is reviewing the daemon-derived selection summary.
        </p>
      ) : null}
    </section>
  );
}

function ChartFrame({
  children,
  detail,
  label,
}: Readonly<{ children: ReactNode; detail: string; label: string }>) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-black/15 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold text-slate-300">{label}</h2>
        <span className="font-mono text-[10px] text-slate-500">{detail}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyChart({ label }: Readonly<{ label: string }>) {
  return (
    <ChartFrame detail="not provided" label={label}>
      <div className="grid h-52 place-items-center text-xs text-slate-500">No series</div>
    </ChartFrame>
  );
}

function MetricCard({ metric }: Readonly<{ metric: LoomMetric }>) {
  return (
    <div
      className="rounded-xl border border-[var(--border)] bg-black/15 p-4"
      title={metric.method.description}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {metric.label}
      </p>
      <p className="mt-2 text-lg font-semibold text-slate-200">{formatMetric(metric)}</p>
      <p className="mt-1 truncate font-mono text-[9px] text-slate-600">
        {metric.sampleScope} · {metric.method.id}
      </p>
    </div>
  );
}

function ProvenanceRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6rem_1fr]">
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="break-all font-mono text-slate-400">{value}</dd>
    </div>
  );
}

function initialViewport(
  timeline: readonly LoomTime[],
  selection: LoomSelection | undefined,
): ViewportState {
  const initial = createViewportState(timeline);
  if (selection === undefined) return initial;
  return applyViewportUpdate(initial, {
    originId: "selection-initial",
    source: "controls",
    selection: { from: selection.from, until: selection.until },
  }).state;
}

function visibleSeriesKeys(resources: BacktestViewResources): LoomSelectionSeriesKey[] {
  return [
    ...(resources.market === null ? [] : (["market"] as const)),
    "equity",
    ...(resources.drawdown === null ? [] : (["drawdown"] as const)),
    ...(resources.trades === null ? [] : (["trades"] as const)),
  ];
}

function filterTimed<T extends { time: LoomTime }>(
  values: readonly T[],
  range: LoomTimeRange,
): readonly T[] {
  return values.filter(
    (value) =>
      compareLoomTime(value.time, range.from) >= 0 && compareLoomTime(value.time, range.until) <= 0,
  );
}

function sameTime(left: LoomTime, right: LoomTime): boolean {
  return left.unit === right.unit && left.epoch === right.epoch;
}

function formatMetric(metric: LoomMetric): string {
  if ("text" in metric) return metric.text;
  if (metric.scale === "percent") return `${(metric.value * 100).toFixed(2)}%`;
  if (metric.unit === "currency" || metric.unit === "price") return formatCurrency(metric.value);
  if (metric.unit === "count") return metric.value.toLocaleString("en-US");
  return metric.value.toFixed(2);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTime(time: LoomTime): string {
  try {
    const epoch = BigInt(time.epoch);
    const milliseconds =
      time.unit === "ms" ? epoch : time.unit === "us" ? epoch / 1_000n : epoch / 1_000_000n;
    const numeric = Number(milliseconds);
    if (!Number.isSafeInteger(numeric)) return `${time.epoch} ${time.unit}`;
    return new Date(numeric).toISOString().slice(0, 10);
  } catch {
    return `${time.epoch} ${time.unit}`;
  }
}
