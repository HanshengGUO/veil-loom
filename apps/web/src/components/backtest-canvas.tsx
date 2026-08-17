import type { LoomMetric, LoomOhlcvPoint, LoomTime, LoomTradeRow } from "@veilquant/loom-protocol";
import type { ReactNode } from "react";
import type { BacktestViewResources } from "../lib/backtest-view";
import { scaleChartValues, svgAreaPath, svgLinePath } from "../lib/chart-geometry";

const CHART_WIDTH = 760;
const CHART_HEIGHT = 210;
const CHART_PADDING = 18;

export function BacktestCanvas({ resources }: Readonly<{ resources: BacktestViewResources }>) {
  const { view } = resources;
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

      <MarketChart market={resources.market?.points ?? []} trades={resources.trades?.rows ?? []} />
      <EquityChart
        drawdown={resources.drawdown?.points.map((point) => point.value) ?? []}
        equity={resources.equity.points.map((point) => point.value)}
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

function MarketChart({
  market,
  trades,
}: Readonly<{ market: readonly LoomOhlcvPoint[]; trades: readonly LoomTradeRow[] }>) {
  if (market.length === 0) return <EmptyChart label="Market and trades" />;
  const priceValues = market.flatMap((point) => [point.low, point.high]);
  const priceScale = scaleChartValues(priceValues, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);
  const minimum = priceScale.minimum;
  const maximum = priceScale.maximum;
  const span = maximum - minimum || 1;
  const xFor = (index: number) =>
    CHART_PADDING + (index / Math.max(1, market.length - 1)) * (CHART_WIDTH - CHART_PADDING * 2);
  const yFor = (value: number) =>
    CHART_PADDING + ((maximum - value) / span) * (CHART_HEIGHT - CHART_PADDING * 2);
  const indexByEpoch = new Map(market.map((point, index) => [point.time.epoch, index]));

  return (
    <ChartFrame
      detail={`${market.length} sessions · ${trades.length} executions`}
      label="Market and trades"
    >
      <svg
        aria-label="Daily OHLC market chart with normalized execution markers"
        className="h-52 w-full"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <title>Daily OHLC market chart with normalized execution markers</title>
        {market.map((point, index) => {
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
                width={Math.max(5, CHART_WIDTH / market.length / 3)}
                x={x - Math.max(5, CHART_WIDTH / market.length / 3) / 2}
                y={Math.min(open, close)}
              />
            </g>
          );
        })}
        {trades.map((trade) => {
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
      </svg>
    </ChartFrame>
  );
}

function EquityChart({
  equity,
  drawdown,
}: Readonly<{ equity: readonly number[]; drawdown: readonly number[] }>) {
  if (equity.length === 0) return <EmptyChart label="Net equity and drawdown" />;
  const equityScale = scaleChartValues(equity, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);
  const drawdownValues = drawdown.length === equity.length ? drawdown : equity.map(() => 0);
  const drawdownScale = scaleChartValues(drawdownValues, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);
  return (
    <ChartFrame
      detail={`${formatCurrency(equity[0] ?? 0)} → ${formatCurrency(equity.at(-1) ?? 0)}`}
      label="Net equity and drawdown"
    >
      <svg
        aria-label="Net equity curve with drawdown area"
        className="h-52 w-full"
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
      </svg>
    </ChartFrame>
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
