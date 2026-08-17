import { randomUUID } from "node:crypto";
import {
  compareLoomTime,
  isLoomCreateSelectionRequest,
  isLoomSelection,
  isLoomSelectionCreatedPayload,
  LOOM_SELECTION_MAX_POINTS,
  type LoomAcceptedCommandResponse,
  type LoomBacktestView,
  type LoomBlobContent,
  type LoomCreateSelectionRequest,
  type LoomMarketSeriesContent,
  type LoomMetric,
  type LoomScalarSeriesContent,
  type LoomSelection,
  type LoomSelectionCreatedPayload,
  type LoomSelectionSeriesKey,
  type LoomTradesTableContent,
} from "@veilquant/loom-protocol";
import type { SessionEventStoreRegistry } from "./event-store.js";
import type { ResearchArtifactStore } from "./research-artifacts.js";

export type SelectionArtifactReader = Pick<ResearchArtifactStore, "readView" | "readBlobForView">;

export type SelectionServiceErrorCode = "SELECTION_NOT_FOUND" | "SELECTION_INVALID";

export class SelectionServiceError extends Error {
  readonly code: SelectionServiceErrorCode;

  constructor(code: SelectionServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SelectionServiceError";
    this.code = code;
  }
}

export interface SelectionServiceOptions {
  artifacts: SelectionArtifactReader;
  eventStores: SessionEventStoreRegistry;
  clock?: () => string;
  idSource?: (kind: "command" | "selection") => string;
}

export interface CreateSelectionInput {
  projectId: string;
  sessionId: string;
  request: LoomCreateSelectionRequest;
}

const SERIES_ORDER: readonly LoomSelectionSeriesKey[] = ["market", "equity", "drawdown", "trades"];

/** Creates durable, ownership-bound selections from canonical view resources. */
export class SelectionService {
  readonly #artifacts: SelectionArtifactReader;
  readonly #eventStores: SessionEventStoreRegistry;
  readonly #clock: () => string;
  readonly #idSource: (kind: "command" | "selection") => string;

  constructor(options: SelectionServiceOptions) {
    this.#artifacts = options.artifacts;
    this.#eventStores = options.eventStores;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#idSource = options.idSource ?? ((kind) => `${kind}_${randomUUID()}`);
  }

  async create(input: CreateSelectionInput): Promise<LoomAcceptedCommandResponse> {
    if (!isLoomCreateSelectionRequest(input.request)) {
      throw invalidSelection("The selection request is invalid");
    }
    const view = await this.#artifacts.readView({
      projectId: input.projectId,
      sessionId: input.sessionId,
      viewId: input.request.viewId,
    });
    const seriesKeys = SERIES_ORDER.filter((key) => input.request.seriesKeys.includes(key));
    assertVisibleSeries(view, seriesKeys);

    const market = await this.#readSeries(view, "market");
    if (market.format !== "loom.series.v0" || market.kind !== "ohlcv") {
      throw invalidSelection("The view's market series is invalid");
    }
    const marketPoints = pointsWithin(market, input.request.from, input.request.until);
    if (
      marketPoints.length < 2 ||
      marketPoints.length > LOOM_SELECTION_MAX_POINTS ||
      !sameTime(marketPoints[0]?.time, input.request.from) ||
      !sameTime(marketPoints.at(-1)?.time, input.request.until)
    ) {
      throw invalidSelection("The selection range is outside the view or has an invalid size");
    }

    const visibleSummary: LoomMetric[] = [];
    for (const key of seriesKeys) {
      const content = key === "market" ? market : await this.#readSeries(view, key);
      visibleSummary.push(summaryMetric(key, content, input.request.from, input.request.until));
    }

    const commandId = this.#idSource("command");
    const selection: LoomSelection = {
      format: "loom.selection.v0",
      selectionId: this.#idSource("selection"),
      projectId: input.projectId,
      sessionId: input.sessionId,
      viewId: view.viewId,
      from: input.request.from,
      until: input.request.until,
      seriesKeys,
      visibleSummary,
      createdAt: this.#clock(),
    };
    if (!isLoomSelection(selection)) {
      throw invalidSelection("The daemon could not produce a valid selection");
    }
    const payload = {
      format: "loom.selection-created.v0",
      commandId,
      selection,
    } satisfies LoomSelectionCreatedPayload;
    if (!isLoomSelectionCreatedPayload(payload)) {
      throw invalidSelection("The daemon could not produce a valid selection event");
    }
    const store = await this.#eventStores.get(input.projectId, input.sessionId);
    await store.append({ type: "selection.created", payload });
    return {
      format: "loom.command.accepted.v0",
      commandId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      selectionId: selection.selectionId,
    };
  }

  async resolve(projectId: string, sessionId: string, selectionId: string): Promise<LoomSelection> {
    const store = await this.#eventStores.get(projectId, sessionId);
    const events = await store.replay();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== "selection.created" || !isLoomSelectionCreatedPayload(event.payload)) {
        continue;
      }
      const selection = event.payload.selection;
      if (selection.selectionId !== selectionId) continue;
      if (selection.projectId !== projectId || selection.sessionId !== sessionId) break;
      return selection;
    }
    throw new SelectionServiceError("SELECTION_NOT_FOUND", "The selection was not found");
  }

  async #readSeries(view: LoomBacktestView, key: LoomSelectionSeriesKey): Promise<LoomBlobContent> {
    const reference = view[key];
    if (reference === null) throw invalidSelection(`The ${key} series is not visible in this view`);
    const record = await this.#artifacts.readBlobForView({
      projectId: view.provenance.projectId,
      sessionId: view.provenance.sessionId,
      viewId: view.viewId,
      blobId: reference.blobId,
    });
    return record.content;
  }
}

function assertVisibleSeries(
  view: LoomBacktestView,
  seriesKeys: readonly LoomSelectionSeriesKey[],
): void {
  if (seriesKeys.length === 0 || seriesKeys.some((key) => view[key] === null)) {
    throw invalidSelection("The selection requests a series that is not visible in this view");
  }
}

function pointsWithin(
  content: LoomMarketSeriesContent,
  from: LoomCreateSelectionRequest["from"],
  until: LoomCreateSelectionRequest["until"],
) {
  if (content.timeUnit !== from.unit || from.unit !== until.unit) return [];
  return content.points.filter(
    (point) => compareLoomTime(point.time, from) >= 0 && compareLoomTime(point.time, until) <= 0,
  );
}

function summaryMetric(
  key: LoomSelectionSeriesKey,
  content: LoomBlobContent,
  from: LoomCreateSelectionRequest["from"],
  until: LoomCreateSelectionRequest["until"],
): LoomMetric {
  if (content.timeUnit !== from.unit || from.unit !== until.unit) {
    throw invalidSelection(`The ${key} series uses an incompatible time unit`);
  }
  if (key === "market") {
    if (content.format !== "loom.series.v0" || content.kind !== "ohlcv") {
      throw invalidSelection("The market series has an invalid shape");
    }
    const points = content.points.filter(
      (point) => compareLoomTime(point.time, from) >= 0 && compareLoomTime(point.time, until) <= 0,
    );
    return rangeMetric(
      "selection.market_return",
      "Market return",
      relativeChange(points[0]?.close, points.at(-1)?.close),
      "Close-to-close return over the selected range.",
    );
  }
  if (key === "equity" || key === "drawdown") {
    if (
      content.format !== "loom.series.v0" ||
      content.kind !== "scalar" ||
      content.seriesKey !== key
    ) {
      throw invalidSelection(`The ${key} series has an invalid shape`);
    }
    const points = scalarPointsWithin(content, from, until);
    if (points.length === 0) throw invalidSelection(`The ${key} series has no selected points`);
    if (key === "equity") {
      return rangeMetric(
        "selection.net_return",
        "Net return",
        relativeChange(points[0]?.value, points.at(-1)?.value),
        "Net-equity return over the selected range.",
      );
    }
    return rangeMetric(
      "selection.max_drawdown",
      "Maximum drawdown",
      Math.min(...points.map((point) => point.value)),
      "Lowest drawdown observation in the selected range.",
    );
  }
  if (content.format !== "loom.table.v0" || content.kind !== "trades") {
    throw invalidSelection("The trades table has an invalid shape");
  }
  const executions = rowsWithin(content, from, until).length;
  return {
    key: "selection.execution_count",
    label: "Executions",
    unit: "count",
    scale: "linear",
    sampleScope: "selection",
    method: {
      id: "selected_execution_count.v0",
      description: "Execution rows whose timestamps fall inside the selected range.",
    },
    value: executions,
  };
}

function scalarPointsWithin(
  content: LoomScalarSeriesContent,
  from: LoomCreateSelectionRequest["from"],
  until: LoomCreateSelectionRequest["until"],
) {
  return content.points.filter(
    (point) => compareLoomTime(point.time, from) >= 0 && compareLoomTime(point.time, until) <= 0,
  );
}

function rowsWithin(
  content: LoomTradesTableContent,
  from: LoomCreateSelectionRequest["from"],
  until: LoomCreateSelectionRequest["until"],
) {
  return content.rows.filter(
    (row) => compareLoomTime(row.time, from) >= 0 && compareLoomTime(row.time, until) <= 0,
  );
}

function relativeChange(first: number | undefined, last: number | undefined): number {
  if (first === undefined || last === undefined || first === 0) {
    throw invalidSelection("The selected series does not contain enough observations");
  }
  return last / first - 1;
}

function rangeMetric(key: string, label: string, value: number, description: string): LoomMetric {
  return {
    key,
    label,
    unit: "ratio",
    scale: "percent",
    sampleScope: "selection",
    method: { id: "selected_range.v0", description },
    value,
  };
}

function sameTime(
  left: LoomCreateSelectionRequest["from"] | undefined,
  right: LoomCreateSelectionRequest["from"],
): boolean {
  return left !== undefined && left.unit === right.unit && left.epoch === right.epoch;
}

function invalidSelection(message: string): SelectionServiceError {
  return new SelectionServiceError("SELECTION_INVALID", message);
}
