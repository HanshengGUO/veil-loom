import {
  isLoomBacktestView,
  isLoomBlobRecord,
  LOOM_JSON_BLOB_MAX_BYTES,
  LOOM_VIEW_MAX_RECORD_BYTES,
  type LoomBacktestView,
  type LoomBlobContent,
  type LoomBlobRecord,
  type LoomBlobReference,
  type LoomMarketSeriesContent,
  type LoomPublishedViewDescriptor,
  type LoomScalarSeriesContent,
  type LoomTradesTableContent,
} from "@veilquant/loom-protocol";
import { bootstrapDaemonSession, type FetchPort, resolveDaemonOrigin } from "./daemon-auth";

export interface BacktestViewResources {
  view: LoomBacktestView;
  market: LoomMarketSeriesContent | null;
  equity: LoomScalarSeriesContent;
  drawdown: LoomScalarSeriesContent | null;
  trades: LoomTradesTableContent | null;
}

export interface LoadBacktestViewOptions {
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
  descriptor: LoomPublishedViewDescriptor;
  signal?: AbortSignal;
  fetchPort?: FetchPort;
  authorize?: () => Promise<void>;
}

export class BacktestViewLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BacktestViewLoadError";
  }
}

export async function loadBacktestViewResources(
  options: LoadBacktestViewOptions,
): Promise<BacktestViewResources> {
  const daemonOrigin = resolveDaemonOrigin(options.daemonOrigin);
  const fetchPort = options.fetchPort ?? globalThis.fetch;
  await (options.authorize ?? (() => bootstrapDaemonSession(daemonOrigin, fetchPort)))();
  const ownership = new URLSearchParams({
    projectId: options.projectId,
    sessionId: options.sessionId,
  });
  const viewInput = await fetchJson(
    `${daemonOrigin}/v0/views/${encodeURIComponent(options.descriptor.viewId)}?${ownership}`,
    LOOM_VIEW_MAX_RECORD_BYTES,
    fetchPort,
    options.signal,
  );
  if (!isLoomBacktestView(viewInput)) {
    throw new BacktestViewLoadError("The daemon returned an invalid backtest view");
  }
  assertDescriptorOwnership(viewInput, options);

  const references = [viewInput.market, viewInput.equity, viewInput.drawdown, viewInput.trades];
  const records = await Promise.all(
    references.map(async (reference) => {
      if (reference === null) return null;
      const query = new URLSearchParams({
        projectId: options.projectId,
        sessionId: options.sessionId,
        viewId: viewInput.viewId,
      });
      const input = await fetchJson(
        `${daemonOrigin}/v0/blobs/${encodeURIComponent(reference.blobId)}?${query}`,
        LOOM_JSON_BLOB_MAX_BYTES + LOOM_VIEW_MAX_RECORD_BYTES,
        fetchPort,
        options.signal,
      );
      if (!isLoomBlobRecord(input) || !recordMatchesReference(input, reference)) {
        throw new BacktestViewLoadError("The daemon returned an invalid view resource");
      }
      return input;
    }),
  );
  const market = records[0] ?? null;
  const equity = records[1] ?? null;
  const drawdown = records[2] ?? null;
  const trades = records[3] ?? null;
  if (
    equity === null ||
    equity.content.format !== "loom.series.v0" ||
    equity.content.seriesKey !== "equity"
  ) {
    throw new BacktestViewLoadError("The backtest view has no valid equity series");
  }
  return {
    view: viewInput,
    market: marketContent(market),
    equity: equity.content,
    drawdown: scalarContent(drawdown, "drawdown"),
    trades: tradesContent(trades),
  };
}

async function fetchJson(
  url: string,
  maximumBytes: number,
  fetchPort: FetchPort,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchPort(url, {
      method: "GET",
      cache: "force-cache",
      credentials: "include",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    throw new BacktestViewLoadError("The research view could not be loaded", { cause: error });
  }
  if (!response.ok) throw new BacktestViewLoadError("The daemon rejected the research view");
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
    throw new BacktestViewLoadError("The research view exceeded its size limit");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new BacktestViewLoadError("The research view exceeded its size limit");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new BacktestViewLoadError("The daemon returned malformed research data", {
      cause: error,
    });
  }
}

function assertDescriptorOwnership(view: LoomBacktestView, options: LoadBacktestViewOptions): void {
  const descriptor = options.descriptor;
  if (
    view.viewId !== descriptor.viewId ||
    view.format !== descriptor.viewFormat ||
    view.title !== descriptor.title ||
    view.summary !== descriptor.summary ||
    view.provenance.projectId !== options.projectId ||
    view.provenance.sessionId !== options.sessionId ||
    view.provenance.taskId !== descriptor.taskId ||
    canonicalSignature(view.assurance) !== canonicalSignature(descriptor.assurance)
  ) {
    throw new BacktestViewLoadError("The view does not match its durable event descriptor");
  }
}

function canonicalSignature(input: unknown): string {
  return JSON.stringify(sortJson(input));
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortJson);
  if (input === null || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => [key, sortJson(value)]),
  );
}

function recordMatchesReference(record: LoomBlobRecord, reference: LoomBlobReference): boolean {
  if (record.blobId !== reference.blobId || record.content.format !== reference.contentFormat) {
    return false;
  }
  const content = record.content;
  if (content.format === "loom.table.v0") {
    return (
      content.kind === reference.kind &&
      content.tableKey === reference.key &&
      content.rows.length === reference.itemCount
    );
  }
  return (
    content.kind === reference.kind &&
    content.seriesKey === reference.key &&
    content.points.length === reference.itemCount
  );
}

function marketContent(record: LoomBlobRecord | null): LoomMarketSeriesContent | null {
  const content = record?.content;
  return content?.format === "loom.series.v0" && content.seriesKey === "market" ? content : null;
}

function scalarContent(
  record: LoomBlobRecord | null,
  key: "drawdown",
): LoomScalarSeriesContent | null {
  const content = record?.content;
  return content?.format === "loom.series.v0" && content.seriesKey === key ? content : null;
}

function tradesContent(record: LoomBlobRecord | null): LoomTradesTableContent | null {
  const content: LoomBlobContent | undefined = record?.content;
  return content?.format === "loom.table.v0" && content.tableKey === "trades" ? content : null;
}
