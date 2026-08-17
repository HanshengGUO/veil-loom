import { compareLoomTime, type LoomTime } from "@veilquant/loom-protocol";

export interface LoomTimeRange {
  from: LoomTime;
  until: LoomTime;
}

export type ViewportSource = "market" | "equity" | "controls";

export interface ViewportState {
  domain: LoomTimeRange;
  visible: LoomTimeRange;
  crosshair: LoomTime | undefined;
  selection: LoomTimeRange | undefined;
  seriesResolution: number;
  revision: number;
  lastOrigin: { id: string; source: ViewportSource } | undefined;
  recentOriginIds: readonly string[];
}

export interface ViewportUpdate {
  originId: string;
  source: ViewportSource;
  visible?: LoomTimeRange;
  crosshair?: LoomTime | null;
  selection?: LoomTimeRange | null;
  seriesResolution?: number;
}

export interface ViewportUpdateResult {
  state: ViewportState;
  outcome: "applied" | "duplicate" | "rejected";
}

const MAX_RECENT_ORIGINS = 32;

export function createViewportState(times: readonly LoomTime[]): ViewportState {
  assertTimeline(times);
  const first = times[0];
  const last = times.at(-1);
  if (first === undefined || last === undefined) throw new Error("The chart timeline is empty");
  const domain = { from: first, until: last };
  return {
    domain,
    visible: domain,
    crosshair: undefined,
    selection: undefined,
    seriesResolution: times.length,
    revision: 0,
    lastOrigin: undefined,
    recentOriginIds: [],
  };
}

export function applyViewportUpdate(
  state: ViewportState,
  update: ViewportUpdate,
): ViewportUpdateResult {
  if (!isOriginId(update.originId)) return { state, outcome: "rejected" };
  if (state.recentOriginIds.includes(update.originId)) return { state, outcome: "duplicate" };
  const visible = update.visible ?? state.visible;
  const crosshair = update.crosshair === null ? undefined : (update.crosshair ?? state.crosshair);
  const selection = update.selection === null ? undefined : (update.selection ?? state.selection);
  const seriesResolution = update.seriesResolution ?? state.seriesResolution;
  if (
    !rangeWithin(visible, state.domain) ||
    (crosshair !== undefined && !timeWithin(crosshair, state.domain)) ||
    (selection !== undefined && !rangeWithin(selection, state.domain)) ||
    !Number.isSafeInteger(seriesResolution) ||
    seriesResolution < 2 ||
    seriesResolution > 4_096
  ) {
    return { state, outcome: "rejected" };
  }
  const recentOriginIds = [...state.recentOriginIds, update.originId].slice(-MAX_RECENT_ORIGINS);
  return {
    outcome: "applied",
    state: {
      ...state,
      visible,
      crosshair,
      selection,
      seriesResolution,
      revision: state.revision + 1,
      lastOrigin: { id: update.originId, source: update.source },
      recentOriginIds,
    },
  };
}

export function zoomViewport(
  times: readonly LoomTime[],
  visible: LoomTimeRange,
  factor: number,
  anchor: LoomTime,
): LoomTimeRange {
  assertTimeline(times);
  if (!Number.isFinite(factor) || factor <= 0) return visible;
  const bounds = rangeIndices(times, visible);
  const anchorIndex = nearestIndex(times, anchor);
  const width = bounds.until - bounds.from + 1;
  const nextWidth = Math.max(2, Math.min(times.length, Math.round(width * factor)));
  if (nextWidth === width) return visible;
  const ratio = width <= 1 ? 0.5 : (anchorIndex - bounds.from) / (width - 1);
  let fromIndex = Math.round(anchorIndex - ratio * (nextWidth - 1));
  fromIndex = Math.max(0, Math.min(times.length - nextWidth, fromIndex));
  return rangeAt(times, fromIndex, fromIndex + nextWidth - 1);
}

export function panViewport(
  times: readonly LoomTime[],
  visible: LoomTimeRange,
  steps: number,
): LoomTimeRange {
  assertTimeline(times);
  if (!Number.isFinite(steps)) return visible;
  const bounds = rangeIndices(times, visible);
  const width = bounds.until - bounds.from + 1;
  let fromIndex = bounds.from + Math.trunc(steps);
  fromIndex = Math.max(0, Math.min(times.length - width, fromIndex));
  return rangeAt(times, fromIndex, fromIndex + width - 1);
}

export function timesInRange(
  times: readonly LoomTime[],
  range: LoomTimeRange,
): readonly LoomTime[] {
  return times.filter(
    (time) => compareLoomTime(time, range.from) >= 0 && compareLoomTime(time, range.until) <= 0,
  );
}

export function orderedRange(left: LoomTime, right: LoomTime): LoomTimeRange {
  return compareLoomTime(left, right) <= 0
    ? { from: left, until: right }
    : { from: right, until: left };
}

export function sameRange(left: LoomTimeRange, right: LoomTimeRange): boolean {
  return sameTime(left.from, right.from) && sameTime(left.until, right.until);
}

function assertTimeline(times: readonly LoomTime[]): void {
  if (times.length < 2) throw new Error("A chart timeline needs at least two observations");
  for (let index = 0; index < times.length; index += 1) {
    const current = times[index];
    const previous = times[index - 1];
    if (
      current === undefined ||
      (previous !== undefined &&
        (previous.unit !== current.unit || compareLoomTime(previous, current) >= 0))
    ) {
      throw new Error("The chart timeline must be strictly ordered in one time unit");
    }
  }
}

function rangeWithin(range: LoomTimeRange, domain: LoomTimeRange): boolean {
  return (
    range.from.unit === range.until.unit &&
    range.from.unit === domain.from.unit &&
    compareLoomTime(range.from, range.until) <= 0 &&
    compareLoomTime(range.from, domain.from) >= 0 &&
    compareLoomTime(range.until, domain.until) <= 0
  );
}

function timeWithin(time: LoomTime, domain: LoomTimeRange): boolean {
  return (
    time.unit === domain.from.unit &&
    compareLoomTime(time, domain.from) >= 0 &&
    compareLoomTime(time, domain.until) <= 0
  );
}

function rangeIndices(times: readonly LoomTime[], range: LoomTimeRange) {
  const from = times.findIndex((time) => sameTime(time, range.from));
  const until = times.findIndex((time) => sameTime(time, range.until));
  if (from < 0 || until < from) throw new Error("The viewport is not aligned to the timeline");
  return { from, until };
}

function nearestIndex(times: readonly LoomTime[], target: LoomTime): number {
  let best = 0;
  const first = times[0];
  if (first === undefined) throw new Error("The chart timeline is empty");
  let distance = absoluteDifference(first, target);
  for (let index = 1; index < times.length; index += 1) {
    const time = times[index];
    if (time === undefined) throw new Error("The chart timeline is sparse");
    const candidate = absoluteDifference(time, target);
    if (candidate < distance) {
      best = index;
      distance = candidate;
    }
  }
  return best;
}

function absoluteDifference(left: LoomTime, right: LoomTime): bigint {
  const factors = { ms: 1_000_000n, us: 1_000n, ns: 1n } as const;
  const value = BigInt(left.epoch) * factors[left.unit] - BigInt(right.epoch) * factors[right.unit];
  return value < 0n ? -value : value;
}

function rangeAt(times: readonly LoomTime[], fromIndex: number, untilIndex: number): LoomTimeRange {
  const from = times[fromIndex];
  const until = times[untilIndex];
  if (from === undefined || until === undefined) throw new Error("The viewport index is invalid");
  return { from, until };
}

function sameTime(left: LoomTime, right: LoomTime): boolean {
  return left.unit === right.unit && left.epoch === right.epoch;
}

function isOriginId(input: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input);
}
