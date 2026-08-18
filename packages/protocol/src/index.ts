import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

export const LOOM_PROTOCOL_VERSION = "0" as const;

export const LoomSessionProfileSchema = Type.Union([Type.Literal("raw-pi"), Type.Literal("veil")], {
  $id: "LoomSessionProfile",
});

export type LoomSessionProfile = Static<typeof LoomSessionProfileSchema>;

export const LoomCapabilitySchema = Type.Union(
  [
    Type.Literal("chat"),
    Type.Literal("local-code"),
    Type.Literal("loom-chart"),
    Type.Literal("loom-selection"),
    Type.Literal("task-cancel"),
    Type.Literal("session-replay"),
    Type.Literal("veil-data"),
    Type.Literal("veil-promotion"),
    Type.Literal("veil-experiment"),
    Type.Literal("veil-reproduction"),
  ],
  { $id: "LoomCapability" },
);

export type LoomCapability = Static<typeof LoomCapabilitySchema>;

export const LoomProfileDescriptorSchema = Type.Object(
  {
    id: LoomSessionProfileSchema,
    label: Type.String({ minLength: 1 }),
    assurance: Type.Union([
      Type.Literal("exploration-only"),
      Type.Literal("veil-verification-available"),
    ]),
    capabilities: Type.Array(LoomCapabilitySchema, { minItems: 1, uniqueItems: true }),
  },
  { additionalProperties: false, $id: "LoomProfileDescriptor" },
);

export type LoomProfileDescriptor = Static<typeof LoomProfileDescriptorSchema>;

export const LoomPiRuntimeDescriptorSchema = Type.Object(
  {
    format: Type.Literal("loom.pi-runtime.v0"),
    package: Type.Literal("@earendil-works/pi-coding-agent"),
    version: Type.String({ minLength: 1 }),
    provider: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal("offline-fixture"), Type.Literal("provider")]),
    fingerprint: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$" }),
  },
  { additionalProperties: false, $id: "LoomPiRuntimeDescriptor" },
);

export type LoomPiRuntimeDescriptor = Static<typeof LoomPiRuntimeDescriptorSchema>;

export function isLoomPiRuntimeDescriptor(input: unknown): input is LoomPiRuntimeDescriptor {
  return Check(LoomPiRuntimeDescriptorSchema, input);
}

const SHARED_CAPABILITIES = [
  "chat",
  "local-code",
  "loom-chart",
  "loom-selection",
  "task-cancel",
  "session-replay",
] as const satisfies readonly LoomCapability[];

export const RAW_PI_PROFILE: LoomProfileDescriptor = {
  id: "raw-pi",
  label: "Raw Pi",
  assurance: "exploration-only",
  capabilities: [...SHARED_CAPABILITIES],
};

export const VEIL_PROFILE: LoomProfileDescriptor = {
  id: "veil",
  label: "Veil",
  assurance: "veil-verification-available",
  capabilities: [
    ...SHARED_CAPABILITIES,
    "veil-data",
    "veil-promotion",
    "veil-experiment",
    "veil-reproduction",
  ],
};

export const LOOM_PROFILE_DESCRIPTORS: LoomProfileDescriptor[] = [RAW_PI_PROFILE, VEIL_PROFILE];

export const LoomAssuranceStateSchema = Type.Union(
  [
    Type.Literal("exploratory"),
    Type.Literal("contract-verified-unverified"),
    Type.Literal("accepted"),
    Type.Literal("degraded"),
    Type.Literal("rejected"),
  ],
  { $id: "LoomAssuranceState" },
);

export type LoomAssuranceState = Static<typeof LoomAssuranceStateSchema>;

export const LoomAssuranceSchema = Type.Object(
  {
    format: Type.Literal("loom.assurance.v0"),
    state: LoomAssuranceStateSchema,
    issuer: Type.Union([Type.Literal("loom"), Type.Literal("veil")]),
    evidenceRefs: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    limitations: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false, $id: "LoomAssurance" },
);

export type LoomAssurance = Static<typeof LoomAssuranceSchema>;

export function isLoomAssurance(input: unknown): input is LoomAssurance {
  if (!Check(LoomAssuranceSchema, input)) return false;
  if (input.state === "exploratory") {
    return input.issuer === "loom" && input.evidenceRefs.length === 0;
  }
  return input.issuer === "veil" && input.evidenceRefs.length > 0;
}

export const LOOM_SERIES_MAX_POINTS = 4_096;
export const LOOM_SELECTION_MAX_POINTS = 1_024;
export const LOOM_JSON_BLOB_MAX_BYTES = 256 * 1_024;
export const LOOM_VIEW_MAX_TOTAL_BLOB_BYTES = 1_024 * 1_024;
export const LOOM_VIEW_MAX_RECORD_BYTES = 64 * 1_024;

const CONTENT_ID_PATTERN = "^(blob|view)_[a-f0-9]{64}$";
const DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";
const METRIC_KEY_PATTERN = "^[a-z][a-z0-9._-]{0,63}$";
const EPOCH_PATTERN = "^-?(0|[1-9][0-9]*)$";

export const LoomContentIdSchema = Type.String({ pattern: CONTENT_ID_PATTERN });
export const LoomDigestSchema = Type.String({ pattern: DIGEST_PATTERN });
export type LoomDigest = Static<typeof LoomDigestSchema>;
export const LoomTimeUnitSchema = Type.Union([
  Type.Literal("ms"),
  Type.Literal("us"),
  Type.Literal("ns"),
]);
export type LoomTimeUnit = Static<typeof LoomTimeUnitSchema>;

export const LoomTimeSchema = Type.Object(
  {
    epoch: Type.String({ pattern: EPOCH_PATTERN }),
    unit: LoomTimeUnitSchema,
  },
  { additionalProperties: false, $id: "LoomTime" },
);
export type LoomTime = Static<typeof LoomTimeSchema>;

export const LoomOhlcvPointSchema = Type.Object(
  {
    time: LoomTimeSchema,
    open: Type.Number(),
    high: Type.Number(),
    low: Type.Number(),
    close: Type.Number(),
    volume: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false, $id: "LoomOhlcvPoint" },
);
export type LoomOhlcvPoint = Static<typeof LoomOhlcvPointSchema>;

export const LoomScalarPointSchema = Type.Object(
  { time: LoomTimeSchema, value: Type.Number() },
  { additionalProperties: false, $id: "LoomScalarPoint" },
);
export type LoomScalarPoint = Static<typeof LoomScalarPointSchema>;

export const LoomTradeRowSchema = Type.Object(
  {
    tradeId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    time: LoomTimeSchema,
    side: Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
    price: Type.Number({ exclusiveMinimum: 0 }),
    quantity: Type.Number({ exclusiveMinimum: 0 }),
  },
  { additionalProperties: false, $id: "LoomTradeRow" },
);
export type LoomTradeRow = Static<typeof LoomTradeRowSchema>;

const LoomMetricMethodSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    description: Type.String({ minLength: 1, maxLength: 240 }),
  },
  { additionalProperties: false },
);

const LoomMetricCommon = {
  key: Type.String({ pattern: METRIC_KEY_PATTERN }),
  label: Type.String({ minLength: 1, maxLength: 80 }),
  unit: Type.Union([
    Type.Literal("ratio"),
    Type.Literal("percent"),
    Type.Literal("currency"),
    Type.Literal("count"),
    Type.Literal("price"),
  ]),
  scale: Type.Union([
    Type.Literal("linear"),
    Type.Literal("percent"),
    Type.Literal("basis-points"),
  ]),
  sampleScope: Type.Union([Type.Literal("full-sample"), Type.Literal("selection")]),
  method: LoomMetricMethodSchema,
  evidenceRef: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
};

export const LoomMetricSchema = Type.Union(
  [
    Type.Object({ ...LoomMetricCommon, value: Type.Number() }, { additionalProperties: false }),
    Type.Object(
      { ...LoomMetricCommon, text: Type.String({ minLength: 1, maxLength: 160 }) },
      { additionalProperties: false },
    ),
  ],
  { $id: "LoomMetric" },
);
export type LoomMetric = Static<typeof LoomMetricSchema>;

export const LoomRegionSchema = Type.Object(
  {
    regionId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    kind: Type.Literal("drawdown"),
    label: Type.String({ minLength: 1, maxLength: 120 }),
    start: LoomTimeSchema,
    end: LoomTimeSchema,
  },
  { additionalProperties: false, $id: "LoomRegion" },
);
export type LoomRegion = Static<typeof LoomRegionSchema>;

export const LoomBacktestSourceSchema = Type.Object(
  {
    dataId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    dataDigest: LoomDigestSchema,
    artifactId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    artifactDigest: LoomDigestSchema,
  },
  { additionalProperties: false, $id: "LoomBacktestSource" },
);
export type LoomBacktestSource = Static<typeof LoomBacktestSourceSchema>;

export const LoomBacktestRunSchema = Type.Object(
  {
    protocolId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    signalLagSessions: Type.Integer({ minimum: 0 }),
    executionPrice: Type.Union([Type.Literal("open"), Type.Literal("close"), Type.Literal("vwap")]),
    equityBasis: Type.Literal("net"),
    costModel: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: false, $id: "LoomBacktestRun" },
);
export type LoomBacktestRun = Static<typeof LoomBacktestRunSchema>;

export const LoomBacktestImportSchema = Type.Object(
  {
    format: Type.Literal("loom.backtest-import.v0"),
    title: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ minLength: 1, maxLength: 280 }),
    timeUnit: LoomTimeUnitSchema,
    market: Type.Array(LoomOhlcvPointSchema, {
      minItems: 2,
      maxItems: LOOM_SERIES_MAX_POINTS,
    }),
    equity: Type.Array(LoomScalarPointSchema, {
      minItems: 2,
      maxItems: LOOM_SERIES_MAX_POINTS,
    }),
    drawdown: Type.Array(LoomScalarPointSchema, {
      minItems: 2,
      maxItems: LOOM_SERIES_MAX_POINTS,
    }),
    trades: Type.Array(LoomTradeRowSchema, { maxItems: LOOM_SERIES_MAX_POINTS }),
    metrics: Type.Array(LoomMetricSchema, { minItems: 1, maxItems: 64 }),
    regions: Type.Array(LoomRegionSchema, { maxItems: 64 }),
    source: LoomBacktestSourceSchema,
    run: LoomBacktestRunSchema,
  },
  { additionalProperties: false, $id: "LoomBacktestImport" },
);
export type LoomBacktestImport = Static<typeof LoomBacktestImportSchema>;

export function isLoomBacktestImport(input: unknown): input is LoomBacktestImport {
  if (
    !Check(LoomBacktestImportSchema, input) ||
    input.title.trim().length === 0 ||
    input.summary.trim().length === 0
  ) {
    return false;
  }
  if (!orderedTimes(input.market, true) || !orderedTimes(input.equity, true)) return false;
  if (!orderedTimes(input.drawdown, true) || !orderedTimes(input.trades, false)) return false;
  if (!allUseTimeUnit(input, input.timeUnit)) return false;
  if (
    input.market.length !== input.equity.length ||
    input.market.length !== input.drawdown.length
  ) {
    return false;
  }
  for (let index = 0; index < input.market.length; index += 1) {
    const market = input.market[index];
    const equity = input.equity[index];
    const drawdown = input.drawdown[index];
    if (market === undefined || equity === undefined || drawdown === undefined) return false;
    if (market.time.epoch !== equity.time.epoch || market.time.epoch !== drawdown.time.epoch) {
      return false;
    }
    if (
      ![market.open, market.high, market.low, market.close, market.volume].every(Number.isFinite) ||
      market.open <= 0 ||
      market.high <= 0 ||
      market.low <= 0 ||
      market.close <= 0 ||
      market.volume < 0 ||
      market.high < Math.max(market.open, market.low, market.close) ||
      market.low > Math.min(market.open, market.high, market.close) ||
      !Number.isFinite(equity.value) ||
      equity.value <= 0 ||
      !Number.isFinite(drawdown.value) ||
      drawdown.value > 0 ||
      drawdown.value < -1
    ) {
      return false;
    }
  }
  const first = input.market[0]?.time;
  const last = input.market.at(-1)?.time;
  if (first === undefined || last === undefined) return false;
  if (
    input.trades.some(
      (trade) =>
        !Number.isFinite(trade.price) ||
        !Number.isFinite(trade.quantity) ||
        compareLoomTime(trade.time, first) < 0 ||
        compareLoomTime(trade.time, last) > 0,
    )
  ) {
    return false;
  }
  if (!unique(input.metrics.map((metric) => metric.key))) return false;
  if (
    input.metrics.some(
      (metric) =>
        metric.sampleScope !== "full-sample" ||
        metric.label.trim().length === 0 ||
        metric.method.description.trim().length === 0 ||
        ("value" in metric && !Number.isFinite(metric.value)),
    )
  ) {
    return false;
  }
  if (!unique(input.regions.map((region) => region.regionId))) return false;
  return input.regions.every(
    (region) =>
      compareLoomTime(region.start, first) >= 0 &&
      compareLoomTime(region.start, region.end) <= 0 &&
      compareLoomTime(region.end, last) <= 0,
  );
}

export const LoomMarketSeriesContentSchema = Type.Object(
  {
    format: Type.Literal("loom.series.v0"),
    kind: Type.Literal("ohlcv"),
    seriesKey: Type.Literal("market"),
    timeUnit: LoomTimeUnitSchema,
    points: Type.Array(LoomOhlcvPointSchema, {
      minItems: 2,
      maxItems: LOOM_SERIES_MAX_POINTS,
    }),
  },
  { additionalProperties: false, $id: "LoomMarketSeriesContent" },
);
export type LoomMarketSeriesContent = Static<typeof LoomMarketSeriesContentSchema>;

export const LoomScalarSeriesContentSchema = Type.Object(
  {
    format: Type.Literal("loom.series.v0"),
    kind: Type.Literal("scalar"),
    seriesKey: Type.Union([Type.Literal("equity"), Type.Literal("drawdown")]),
    timeUnit: LoomTimeUnitSchema,
    unit: Type.Union([Type.Literal("currency"), Type.Literal("ratio")]),
    points: Type.Array(LoomScalarPointSchema, {
      minItems: 2,
      maxItems: LOOM_SERIES_MAX_POINTS,
    }),
  },
  { additionalProperties: false, $id: "LoomScalarSeriesContent" },
);
export type LoomScalarSeriesContent = Static<typeof LoomScalarSeriesContentSchema>;

export const LoomTradesTableContentSchema = Type.Object(
  {
    format: Type.Literal("loom.table.v0"),
    kind: Type.Literal("trades"),
    tableKey: Type.Literal("trades"),
    timeUnit: LoomTimeUnitSchema,
    rows: Type.Array(LoomTradeRowSchema, { maxItems: LOOM_SERIES_MAX_POINTS }),
  },
  { additionalProperties: false, $id: "LoomTradesTableContent" },
);
export type LoomTradesTableContent = Static<typeof LoomTradesTableContentSchema>;

export const LoomBlobContentSchema = Type.Union(
  [LoomMarketSeriesContentSchema, LoomScalarSeriesContentSchema, LoomTradesTableContentSchema],
  { $id: "LoomBlobContent" },
);
export type LoomBlobContent = Static<typeof LoomBlobContentSchema>;

export function isLoomBlobContent(input: unknown): input is LoomBlobContent {
  if (!Check(LoomBlobContentSchema, input)) return false;
  const items: readonly { time: LoomTime }[] =
    input.format === "loom.table.v0" ? input.rows : input.points;
  if (!orderedTimes(items, input.format !== "loom.table.v0")) return false;
  if (!items.every((item) => item.time.unit === input.timeUnit)) return false;
  if (input.format === "loom.table.v0") {
    return input.rows.every(
      (row) =>
        Number.isFinite(row.price) &&
        row.price > 0 &&
        Number.isFinite(row.quantity) &&
        row.quantity > 0,
    );
  }
  if (input.kind === "ohlcv") {
    return input.points.every(
      (point) =>
        [point.open, point.high, point.low, point.close, point.volume].every(Number.isFinite) &&
        point.open > 0 &&
        point.high > 0 &&
        point.low > 0 &&
        point.close > 0 &&
        point.volume >= 0 &&
        point.high >= Math.max(point.open, point.low, point.close) &&
        point.low <= Math.min(point.open, point.high, point.close),
    );
  }
  return input.points.every(
    (point) =>
      Number.isFinite(point.value) &&
      (input.seriesKey === "equity" ? point.value > 0 : point.value >= -1 && point.value <= 0),
  );
}

export const LoomBlobRecordSchema = Type.Object(
  {
    format: Type.Literal("loom.blob.v0"),
    blobId: LoomContentIdSchema,
    createdAt: Type.String({ minLength: 1 }),
    content: LoomBlobContentSchema,
  },
  { additionalProperties: false, $id: "LoomBlobRecord" },
);
export type LoomBlobRecord = Static<typeof LoomBlobRecordSchema>;

export function isLoomBlobRecord(input: unknown): input is LoomBlobRecord {
  if (!Check(LoomBlobRecordSchema, input) || !input.blobId.startsWith("blob_")) return false;
  if (!isCanonicalIsoTime(input.createdAt)) return false;
  return isLoomBlobContent(input.content);
}

export const LoomBlobReferenceSchema = Type.Object(
  {
    blobId: LoomContentIdSchema,
    contentFormat: Type.Union([Type.Literal("loom.series.v0"), Type.Literal("loom.table.v0")]),
    kind: Type.Union([Type.Literal("ohlcv"), Type.Literal("scalar"), Type.Literal("trades")]),
    key: Type.Union([
      Type.Literal("market"),
      Type.Literal("equity"),
      Type.Literal("drawdown"),
      Type.Literal("trades"),
    ]),
    itemCount: Type.Integer({ minimum: 0, maximum: LOOM_SERIES_MAX_POINTS }),
    byteLength: Type.Integer({ minimum: 1, maximum: LOOM_JSON_BLOB_MAX_BYTES }),
  },
  { additionalProperties: false, $id: "LoomBlobReference" },
);
export type LoomBlobReference = Static<typeof LoomBlobReferenceSchema>;

export const LoomViewProvenanceSchema = Type.Object(
  {
    format: Type.Literal("loom.view-provenance.v0"),
    projectId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    sessionId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    taskId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    adapter: Type.Object(
      {
        id: Type.Literal("loom.reference.daily-factor"),
        version: Type.Literal("0"),
      },
      { additionalProperties: false },
    ),
    source: LoomBacktestSourceSchema,
    run: LoomBacktestRunSchema,
    experimentRef: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false, $id: "LoomViewProvenance" },
);
export type LoomViewProvenance = Static<typeof LoomViewProvenanceSchema>;

export const LoomBacktestViewSchema = Type.Object(
  {
    format: Type.Literal("loom.backtest-view.v0"),
    viewId: LoomContentIdSchema,
    title: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ minLength: 1, maxLength: 280 }),
    createdAt: Type.String({ minLength: 1 }),
    assurance: LoomAssuranceSchema,
    timeRange: Type.Object(
      { start: LoomTimeSchema, end: LoomTimeSchema },
      { additionalProperties: false },
    ),
    market: Type.Union([LoomBlobReferenceSchema, Type.Null()]),
    equity: LoomBlobReferenceSchema,
    drawdown: Type.Union([LoomBlobReferenceSchema, Type.Null()]),
    trades: Type.Union([LoomBlobReferenceSchema, Type.Null()]),
    metrics: Type.Array(LoomMetricSchema, { minItems: 1, maxItems: 64 }),
    regions: Type.Array(LoomRegionSchema, { maxItems: 64 }),
    provenance: LoomViewProvenanceSchema,
  },
  { additionalProperties: false, $id: "LoomBacktestView" },
);
export type LoomBacktestView = Static<typeof LoomBacktestViewSchema>;

export function isLoomBacktestView(input: unknown): input is LoomBacktestView {
  if (!Check(LoomBacktestViewSchema, input) || !input.viewId.startsWith("view_")) return false;
  if (!isCanonicalIsoTime(input.createdAt) || !isLoomAssurance(input.assurance)) return false;
  if (input.title.trim().length === 0 || input.summary.trim().length === 0) return false;
  if (input.assurance.state !== "exploratory" || input.assurance.issuer !== "loom") return false;
  if (input.timeRange.start.unit !== input.timeRange.end.unit) return false;
  if (compareLoomTime(input.timeRange.start, input.timeRange.end) > 0) return false;
  if (!unique(input.metrics.map((metric) => metric.key))) return false;
  if (input.metrics.some((metric) => metric.sampleScope !== "full-sample")) return false;
  if (!unique(input.regions.map((region) => region.regionId))) return false;
  const references = [input.market, input.equity, input.drawdown, input.trades].filter(
    (reference): reference is LoomBlobReference => reference !== null,
  );
  if (!unique(references.map((reference) => reference.blobId))) return false;
  if (
    references.reduce((total, reference) => total + reference.byteLength, 0) >
    LOOM_VIEW_MAX_TOTAL_BLOB_BYTES
  ) {
    return false;
  }
  if (!referenceMatches(input.market, "loom.series.v0", "ohlcv", "market")) return false;
  if (!referenceMatches(input.equity, "loom.series.v0", "scalar", "equity")) return false;
  if (!referenceMatches(input.drawdown, "loom.series.v0", "scalar", "drawdown")) return false;
  if (!referenceMatches(input.trades, "loom.table.v0", "trades", "trades")) return false;
  return input.regions.every(
    (region) =>
      region.start.unit === input.timeRange.start.unit &&
      region.end.unit === input.timeRange.start.unit &&
      compareLoomTime(region.start, input.timeRange.start) >= 0 &&
      compareLoomTime(region.start, region.end) <= 0 &&
      compareLoomTime(region.end, input.timeRange.end) <= 0,
  );
}

export const LoomPublishedViewDescriptorSchema = Type.Object(
  {
    format: Type.Literal("loom.view-published.v0"),
    viewId: LoomContentIdSchema,
    viewFormat: Type.Literal("loom.backtest-view.v0"),
    kind: Type.Literal("backtest"),
    title: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ minLength: 1, maxLength: 280 }),
    taskId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    assurance: LoomAssuranceSchema,
  },
  { additionalProperties: false, $id: "LoomPublishedViewDescriptor" },
);
export type LoomPublishedViewDescriptor = Static<typeof LoomPublishedViewDescriptorSchema>;

export function isLoomPublishedViewDescriptor(
  input: unknown,
): input is LoomPublishedViewDescriptor {
  return (
    Check(LoomPublishedViewDescriptorSchema, input) &&
    input.viewId.startsWith("view_") &&
    input.title.trim().length > 0 &&
    input.summary.trim().length > 0 &&
    isLoomAssurance(input.assurance) &&
    input.assurance.state === "exploratory"
  );
}

export const LoomSelectionSeriesKeySchema = Type.Union(
  [
    Type.Literal("market"),
    Type.Literal("equity"),
    Type.Literal("drawdown"),
    Type.Literal("trades"),
  ],
  { $id: "LoomSelectionSeriesKey" },
);
export type LoomSelectionSeriesKey = Static<typeof LoomSelectionSeriesKeySchema>;

export const LoomCreateSelectionRequestSchema = Type.Object(
  {
    format: Type.Literal("loom.selection.create.v0"),
    viewId: LoomContentIdSchema,
    from: LoomTimeSchema,
    until: LoomTimeSchema,
    seriesKeys: Type.Array(LoomSelectionSeriesKeySchema, { minItems: 1, maxItems: 4 }),
  },
  { additionalProperties: false, $id: "LoomCreateSelectionRequest" },
);
export type LoomCreateSelectionRequest = Static<typeof LoomCreateSelectionRequestSchema>;

export function isLoomCreateSelectionRequest(input: unknown): input is LoomCreateSelectionRequest {
  return (
    Check(LoomCreateSelectionRequestSchema, input) &&
    input.viewId.startsWith("view_") &&
    input.from.unit === input.until.unit &&
    compareLoomTime(input.from, input.until) <= 0 &&
    unique(input.seriesKeys)
  );
}

export const LoomSelectionSchema = Type.Object(
  {
    format: Type.Literal("loom.selection.v0"),
    selectionId: Type.String({ pattern: "^selection_[A-Za-z0-9._-]{1,118}$" }),
    projectId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    sessionId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    viewId: LoomContentIdSchema,
    from: LoomTimeSchema,
    until: LoomTimeSchema,
    seriesKeys: Type.Array(LoomSelectionSeriesKeySchema, { minItems: 1, maxItems: 4 }),
    visibleSummary: Type.Array(LoomMetricSchema, { minItems: 1, maxItems: 4 }),
    createdAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false, $id: "LoomSelection" },
);
export type LoomSelection = Static<typeof LoomSelectionSchema>;

const SELECTION_METRIC_KEYS: Readonly<Record<LoomSelectionSeriesKey, string>> = {
  market: "selection.market_return",
  equity: "selection.net_return",
  drawdown: "selection.max_drawdown",
  trades: "selection.execution_count",
};

export function isLoomSelection(input: unknown): input is LoomSelection {
  if (!Check(LoomSelectionSchema, input)) return false;
  if (!input.viewId.startsWith("view_") || !isCanonicalIsoTime(input.createdAt)) return false;
  if (input.from.unit !== input.until.unit || compareLoomTime(input.from, input.until) > 0) {
    return false;
  }
  if (!unique(input.seriesKeys) || !unique(input.visibleSummary.map((metric) => metric.key))) {
    return false;
  }
  const expectedMetricKeys = input.seriesKeys.map((key) => SELECTION_METRIC_KEYS[key]).sort();
  const actualMetricKeys = input.visibleSummary.map((metric) => metric.key).sort();
  return (
    expectedMetricKeys.length === actualMetricKeys.length &&
    expectedMetricKeys.every((key, index) => key === actualMetricKeys[index]) &&
    input.visibleSummary.every(
      (metric) =>
        metric.sampleScope === "selection" &&
        "value" in metric &&
        Number.isFinite(metric.value) &&
        metric.label.trim().length > 0 &&
        metric.method.description.trim().length > 0,
    )
  );
}

export const LoomSelectionCreatedPayloadSchema = Type.Object(
  {
    format: Type.Literal("loom.selection-created.v0"),
    commandId: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
    selection: LoomSelectionSchema,
  },
  { additionalProperties: false, $id: "LoomSelectionCreatedPayload" },
);
export type LoomSelectionCreatedPayload = Static<typeof LoomSelectionCreatedPayloadSchema>;

export function isLoomSelectionCreatedPayload(
  input: unknown,
): input is LoomSelectionCreatedPayload {
  return Check(LoomSelectionCreatedPayloadSchema, input) && isLoomSelection(input.selection);
}

export const LoomHealthResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.health.v0"),
    service: Type.Literal("veil-loom-daemon"),
    status: Type.Literal("ok"),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false, $id: "LoomHealthResponse" },
);

export type LoomHealthResponse = Static<typeof LoomHealthResponseSchema>;

export const LoomAuthResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.auth.v0"),
    status: Type.Literal("ready"),
  },
  { additionalProperties: false, $id: "LoomAuthResponse" },
);

export type LoomAuthResponse = Static<typeof LoomAuthResponseSchema>;

export function isLoomAuthResponse(input: unknown): input is LoomAuthResponse {
  return Check(LoomAuthResponseSchema, input);
}

export const LoomCapabilitiesResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.capabilities.v0"),
    profiles: Type.Array(LoomProfileDescriptorSchema, { minItems: 1 }),
  },
  { additionalProperties: false, $id: "LoomCapabilitiesResponse" },
);

export type LoomCapabilitiesResponse = Static<typeof LoomCapabilitiesResponseSchema>;

const PORTABLE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
const PORTABLE_ID_REGEXP = new RegExp(PORTABLE_ID_PATTERN);

export const LoomPortableIdSchema = Type.String({
  pattern: PORTABLE_ID_PATTERN,
  $id: "LoomPortableId",
});

export type LoomPortableId = Static<typeof LoomPortableIdSchema>;

export function isLoomPortableId(input: unknown): input is LoomPortableId {
  return typeof input === "string" && PORTABLE_ID_REGEXP.test(input);
}

export const LoomProjectReadinessStatusSchema = Type.Union(
  [Type.Literal("ready"), Type.Literal("invalid"), Type.Literal("unavailable")],
  { $id: "LoomProjectReadinessStatus" },
);

export type LoomProjectReadinessStatus = Static<typeof LoomProjectReadinessStatusSchema>;

export const LoomProjectReadinessIssueSchema = Type.Object(
  {
    code: Type.String({ pattern: "^[A-Z][A-Z0-9_]{1,63}$" }),
    message: Type.String({ minLength: 1, maxLength: 512 }),
    remedy: Type.String({ minLength: 1, maxLength: 1_024 }),
  },
  { additionalProperties: false, $id: "LoomProjectReadinessIssue" },
);

export type LoomProjectReadinessIssue = Static<typeof LoomProjectReadinessIssueSchema>;

export const LoomVeilRuntimeReadinessSchema = Type.Object(
  {
    package: Type.Literal("veil-quant"),
    installedVersion: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    supportedRange: Type.Literal(">=0.1.0 <0.2.0"),
    detectedFormats: Type.Array(Type.Literal("veil.project.v0"), {
      maxItems: 1,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false, $id: "LoomVeilRuntimeReadiness" },
);

export type LoomVeilRuntimeReadiness = Static<typeof LoomVeilRuntimeReadinessSchema>;

export const LoomVeilProjectSummarySchema = Type.Object(
  {
    format: Type.Literal("veil.project.v0"),
    datasetCount: Type.Integer({ minimum: 1 }),
    runtimeCount: Type.Integer({ minimum: 1 }),
    promotionConcurrency: Type.Integer({ minimum: 1, maximum: 16 }),
    costModelCount: Type.Integer({ minimum: 0 }),
    nullGeneratorCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false, $id: "LoomVeilProjectSummary" },
);

export type LoomVeilProjectSummary = Static<typeof LoomVeilProjectSummarySchema>;

export const LoomProjectReadinessResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.project-readiness.v0"),
    projectId: LoomPortableIdSchema,
    profile: Type.Literal("veil"),
    status: LoomProjectReadinessStatusSchema,
    runtime: LoomVeilRuntimeReadinessSchema,
    capabilities: Type.Array(LoomCapabilitySchema, { uniqueItems: true }),
    project: Type.Optional(LoomVeilProjectSummarySchema),
    issue: Type.Optional(LoomProjectReadinessIssueSchema),
  },
  { additionalProperties: false, $id: "LoomProjectReadinessResponse" },
);

export type LoomProjectReadinessResponse = Static<typeof LoomProjectReadinessResponseSchema>;

export function isLoomProjectReadinessResponse(
  input: unknown,
): input is LoomProjectReadinessResponse {
  if (!Check(LoomProjectReadinessResponseSchema, input)) return false;
  const ready = input.status === "ready";
  const runtimeLoaded =
    input.runtime.installedVersion !== null &&
    sameStrings(input.runtime.detectedFormats, ["veil.project.v0"]);
  return (
    (ready
      ? input.project !== undefined && input.issue === undefined
      : input.project === undefined && input.issue !== undefined) &&
    (ready
      ? sameStrings(input.capabilities, VEIL_PROFILE.capabilities)
      : input.capabilities.length === 0) &&
    (input.status === "unavailable" || runtimeLoaded)
  );
}

export const LoomCreateSessionRequestSchema = Type.Object(
  {
    format: Type.Literal("loom.session.create.v0"),
    profile: LoomSessionProfileSchema,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  },
  { additionalProperties: false, $id: "LoomCreateSessionRequest" },
);

export type LoomCreateSessionRequest = Static<typeof LoomCreateSessionRequestSchema>;

export function isLoomCreateSessionRequest(input: unknown): input is LoomCreateSessionRequest {
  if (!Check(LoomCreateSessionRequestSchema, input)) return false;
  return input.title === undefined || input.title.trim().length > 0;
}

export const LoomSendMessageRequestSchema = Type.Object(
  {
    format: Type.Literal("loom.message.send.v0"),
    content: Type.String({ minLength: 1, maxLength: 32_768 }),
    selectionId: Type.Optional(Type.String({ pattern: "^selection_[A-Za-z0-9._-]{1,118}$" })),
  },
  { additionalProperties: false, $id: "LoomSendMessageRequest" },
);

export type LoomSendMessageRequest = Static<typeof LoomSendMessageRequestSchema>;

export function isLoomSendMessageRequest(input: unknown): input is LoomSendMessageRequest {
  return Check(LoomSendMessageRequestSchema, input) && input.content.trim().length > 0;
}

export const LoomCancelTaskRequestSchema = Type.Object(
  { format: Type.Literal("loom.task.cancel.v0") },
  { additionalProperties: false, $id: "LoomCancelTaskRequest" },
);

export type LoomCancelTaskRequest = Static<typeof LoomCancelTaskRequestSchema>;

export function isLoomCancelTaskRequest(input: unknown): input is LoomCancelTaskRequest {
  return Check(LoomCancelTaskRequestSchema, input);
}

export const LoomProjectFileReferenceSchema = Type.String({ minLength: 3, maxLength: 256 });

export type LoomProjectFileReference = Static<typeof LoomProjectFileReferenceSchema>;

export function isLoomProjectFileReference(input: unknown): input is LoomProjectFileReference {
  if (typeof input !== "string" || input.length < 3 || input.length > 256) return false;
  if (
    input.includes("\\") ||
    input.includes("\0") ||
    input.startsWith("/") ||
    input.endsWith("/")
  ) {
    return false;
  }
  const segments = input.split("/");
  return (
    segments.length >= 2 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment.length <= 128 &&
        /^[A-Za-z0-9._@+-]+$/u.test(segment) &&
        segment !== "." &&
        segment !== ".." &&
        ![...segment].some((character) => (character.codePointAt(0) ?? 0) <= 0x1f),
    )
  );
}

export const LoomCreatePromotionRequestSchema = Type.Object(
  {
    format: Type.Literal("loom.promotion.create.v0"),
    viewId: LoomContentIdSchema,
    artifactReference: LoomProjectFileReferenceSchema,
    hypothesis: Type.Object(
      { statement: Type.String({ minLength: 1, maxLength: 4_096 }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false, $id: "LoomCreatePromotionRequest" },
);

export type LoomCreatePromotionRequest = Static<typeof LoomCreatePromotionRequestSchema>;

export function isLoomCreatePromotionRequest(input: unknown): input is LoomCreatePromotionRequest {
  return (
    Check(LoomCreatePromotionRequestSchema, input) &&
    input.viewId.startsWith("view_") &&
    isLoomProjectFileReference(input.artifactReference) &&
    input.hypothesis.statement.trim() === input.hypothesis.statement
  );
}

export const LoomPromotionAcceptedResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.promotion.accepted.v0"),
    commandId: LoomPortableIdSchema,
    projectId: LoomPortableIdSchema,
    sourceSessionId: LoomPortableIdSchema,
    sessionId: LoomPortableIdSchema,
    taskId: LoomPortableIdSchema,
    attemptId: LoomPortableIdSchema,
  },
  { additionalProperties: false, $id: "LoomPromotionAcceptedResponse" },
);

export type LoomPromotionAcceptedResponse = Static<typeof LoomPromotionAcceptedResponseSchema>;

export function isLoomPromotionAcceptedResponse(
  input: unknown,
): input is LoomPromotionAcceptedResponse {
  return (
    Check(LoomPromotionAcceptedResponseSchema, input) && input.sourceSessionId !== input.sessionId
  );
}

export const LoomAcceptedCommandResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.command.accepted.v0"),
    commandId: LoomPortableIdSchema,
    projectId: LoomPortableIdSchema,
    sessionId: LoomPortableIdSchema,
    taskId: Type.Optional(LoomPortableIdSchema),
    selectionId: Type.Optional(Type.String({ pattern: "^selection_[A-Za-z0-9._-]{1,118}$" })),
  },
  { additionalProperties: false, $id: "LoomAcceptedCommandResponse" },
);

export type LoomAcceptedCommandResponse = Static<typeof LoomAcceptedCommandResponseSchema>;

export function isLoomAcceptedCommandResponse(
  input: unknown,
): input is LoomAcceptedCommandResponse {
  return Check(LoomAcceptedCommandResponseSchema, input);
}

const VEIL_REFERENCE_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$";

export const LoomVeilVerificationStartedPayloadSchema = Type.Object(
  {
    format: Type.Literal("loom.veil-verification-started.v0"),
    attemptId: LoomPortableIdSchema,
    commandId: LoomPortableIdSchema,
    taskId: LoomPortableIdSchema,
    relation: Type.Literal("derived-from-exploration"),
    source: Type.Object(
      {
        sessionId: LoomPortableIdSchema,
        viewId: LoomContentIdSchema,
      },
      { additionalProperties: false },
    ),
    artifact: Type.Object(
      {
        id: LoomPortableIdSchema,
        reference: LoomProjectFileReferenceSchema,
        digest: LoomDigestSchema,
      },
      { additionalProperties: false },
    ),
    hypothesis: Type.Object(
      {
        ref: Type.String({ pattern: VEIL_REFERENCE_PATTERN }),
        statement: Type.String({ minLength: 1, maxLength: 4_096 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false, $id: "LoomVeilVerificationStartedPayload" },
);

export type LoomVeilVerificationStartedPayload = Static<
  typeof LoomVeilVerificationStartedPayloadSchema
>;

export function isLoomVeilVerificationStartedPayload(
  input: unknown,
): input is LoomVeilVerificationStartedPayload {
  return (
    Check(LoomVeilVerificationStartedPayloadSchema, input) &&
    input.source.viewId.startsWith("view_") &&
    isLoomProjectFileReference(input.artifact.reference) &&
    input.hypothesis.statement.trim() === input.hypothesis.statement
  );
}

export const LoomVeilStageChangedPayloadSchema = Type.Object(
  {
    format: Type.Literal("loom.veil-stage-changed.v0"),
    attemptId: LoomPortableIdSchema,
    taskId: LoomPortableIdSchema,
    stage: Type.Union([Type.Literal("development-data"), Type.Literal("independent-verification")]),
    status: Type.Union([Type.Literal("running"), Type.Literal("completed")]),
  },
  { additionalProperties: false, $id: "LoomVeilStageChangedPayload" },
);

export type LoomVeilStageChangedPayload = Static<typeof LoomVeilStageChangedPayloadSchema>;

export function isLoomVeilStageChangedPayload(
  input: unknown,
): input is LoomVeilStageChangedPayload {
  return (
    Check(LoomVeilStageChangedPayloadSchema, input) &&
    (input.stage !== "development-data" || input.status === "completed")
  );
}

export const LoomVeilExperimentRecordedPayloadSchema = Type.Object(
  {
    format: Type.Literal("loom.veil-experiment-recorded.v0"),
    attemptId: LoomPortableIdSchema,
    taskId: LoomPortableIdSchema,
    experimentId: LoomDigestSchema,
    archiveHash: LoomDigestSchema,
    researchRunId: Type.String({ pattern: VEIL_REFERENCE_PATTERN }),
    verdict: Type.Union([
      Type.Literal("accepted"),
      Type.Literal("degraded"),
      Type.Literal("rejected"),
    ]),
    claimStatus: Type.Union([
      Type.Literal("verified"),
      Type.Literal("degraded"),
      Type.Literal("rejected"),
    ]),
    registrationStatus: Type.Union([Type.Literal("preregistered"), Type.Literal("exploratory")]),
    artifactHash: LoomDigestSchema,
    planHash: LoomDigestSchema,
    contractHash: LoomDigestSchema,
    candidateHash: LoomDigestSchema,
    executionCount: Type.Integer({ minimum: 1 }),
    assurance: LoomAssuranceSchema,
  },
  { additionalProperties: false, $id: "LoomVeilExperimentRecordedPayload" },
);

export type LoomVeilExperimentRecordedPayload = Static<
  typeof LoomVeilExperimentRecordedPayloadSchema
>;

export function isLoomVeilExperimentRecordedPayload(
  input: unknown,
): input is LoomVeilExperimentRecordedPayload {
  if (!Check(LoomVeilExperimentRecordedPayloadSchema, input) || !isLoomAssurance(input.assurance)) {
    return false;
  }
  const expectedClaimStatus =
    input.verdict === "accepted"
      ? "verified"
      : input.verdict === "degraded"
        ? "degraded"
        : "rejected";
  return (
    input.claimStatus === expectedClaimStatus &&
    input.assurance.state === input.verdict &&
    sameStrings(input.assurance.evidenceRefs, [input.experimentId, input.archiveHash])
  );
}

export const LoomEventTypeSchema = Type.Union(
  [
    Type.Literal("session.created"),
    Type.Literal("session.ready"),
    Type.Literal("session.status_changed"),
    Type.Literal("message.user_appended"),
    Type.Literal("message.assistant_delta"),
    Type.Literal("message.assistant_completed"),
    Type.Literal("tool.started"),
    Type.Literal("tool.progress"),
    Type.Literal("tool.completed"),
    Type.Literal("tool.failed"),
    Type.Literal("task.started"),
    Type.Literal("task.cancel_requested"),
    Type.Literal("task.cancelled"),
    Type.Literal("task.completed"),
    Type.Literal("task.failed"),
    Type.Literal("task.interrupted"),
    Type.Literal("view.published"),
    Type.Literal("view.superseded"),
    Type.Literal("selection.created"),
    Type.Literal("veil.verification_started"),
    Type.Literal("veil.stage_changed"),
    Type.Literal("veil.experiment_recorded"),
    Type.Literal("veil.reproduction_completed"),
    Type.Literal("system.notice"),
  ],
  { $id: "LoomEventType" },
);

export type LoomEventType = Static<typeof LoomEventTypeSchema>;

export const LoomEventPayloadSchema = Type.Record(Type.String(), Type.Unknown(), {
  $id: "LoomEventPayload",
});

export type LoomEventPayload = Static<typeof LoomEventPayloadSchema>;

export const LoomEventEnvelopeSchema = Type.Object(
  {
    format: Type.Literal("loom.event.v0"),
    eventId: LoomPortableIdSchema,
    projectId: LoomPortableIdSchema,
    sessionId: LoomPortableIdSchema,
    sequence: Type.Integer({ minimum: 1 }),
    occurredAt: Type.String({ minLength: 1 }),
    type: LoomEventTypeSchema,
    payload: LoomEventPayloadSchema,
  },
  { additionalProperties: false, $id: "LoomEventEnvelope" },
);

export type LoomEventEnvelope = Static<typeof LoomEventEnvelopeSchema>;

export function isLoomEventEnvelope(input: unknown): input is LoomEventEnvelope {
  try {
    if (!Check(LoomEventEnvelopeSchema, input)) return false;
    return isCanonicalIsoTime(input.occurredAt) && isJsonRecord(input.payload);
  } catch {
    return false;
  }
}

export const LoomEventsResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.events.v0"),
    events: Type.Array(LoomEventEnvelopeSchema),
  },
  { additionalProperties: false, $id: "LoomEventsResponse" },
);

export type LoomEventsResponse = Static<typeof LoomEventsResponseSchema>;

export const LoomErrorCodeSchema = Type.Union(
  [
    Type.Literal("INVALID_REQUEST"),
    Type.Literal("EVENT_CURSOR_AHEAD"),
    Type.Literal("EVENT_LOG_UNAVAILABLE"),
    Type.Literal("AUTH_REQUIRED"),
    Type.Literal("ORIGIN_FORBIDDEN"),
    Type.Literal("PROFILE_UNAVAILABLE"),
    Type.Literal("PROJECT_NOT_READY"),
    Type.Literal("SESSION_NOT_FOUND"),
    Type.Literal("SESSION_BUSY"),
    Type.Literal("SESSION_CONFLICT"),
    Type.Literal("TASK_NOT_FOUND"),
    Type.Literal("TASK_NOT_CANCELLABLE"),
    Type.Literal("PROMOTION_NOT_AVAILABLE"),
    Type.Literal("RUNTIME_UNAVAILABLE"),
    Type.Literal("VIEW_NOT_FOUND"),
    Type.Literal("BLOB_NOT_FOUND"),
    Type.Literal("VIEW_UNAVAILABLE"),
    Type.Literal("SELECTION_NOT_FOUND"),
    Type.Literal("SELECTION_INVALID"),
    Type.Literal("INTERNAL_ERROR"),
  ],
  { $id: "LoomErrorCode" },
);

export type LoomErrorCode = Static<typeof LoomErrorCodeSchema>;

export const LoomErrorResponseSchema = Type.Object(
  {
    format: Type.Literal("loom.error.v0"),
    code: LoomErrorCodeSchema,
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false, $id: "LoomErrorResponse" },
);

export type LoomErrorResponse = Static<typeof LoomErrorResponseSchema>;

export function compareLoomTime(left: LoomTime, right: LoomTime): number {
  const factors: Record<LoomTimeUnit, bigint> = {
    ms: 1_000_000n,
    us: 1_000n,
    ns: 1n,
  };
  const leftValue = BigInt(left.epoch) * factors[left.unit];
  const rightValue = BigInt(right.epoch) * factors[right.unit];
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function orderedTimes<T extends { time: LoomTime }>(items: readonly T[], strict: boolean): boolean {
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (previous === undefined || current === undefined) return false;
    const comparison = compareLoomTime(previous.time, current.time);
    if (strict ? comparison >= 0 : comparison > 0) return false;
  }
  return true;
}

function allUseTimeUnit(input: LoomBacktestImport, unit: LoomTimeUnit): boolean {
  const timed = [...input.market, ...input.equity, ...input.drawdown, ...input.trades];
  return (
    timed.every((item) => item.time.unit === unit) &&
    input.regions.every((region) => region.start.unit === unit && region.end.unit === unit)
  );
}

function referenceMatches(
  reference: LoomBlobReference | null,
  contentFormat: LoomBlobReference["contentFormat"],
  kind: LoomBlobReference["kind"],
  key: LoomBlobReference["key"],
): boolean {
  return (
    reference === null ||
    (reference.blobId.startsWith("blob_") &&
      reference.contentFormat === contentFormat &&
      reference.kind === kind &&
      reference.key === key)
  );
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isCanonicalIsoTime(input: string): boolean {
  const milliseconds = Date.parse(input);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === input;
}

function isJsonRecord(input: unknown): input is Record<string, unknown> {
  return isJsonValue(input, new WeakSet()) && input !== null && !Array.isArray(input);
}

function isJsonValue(input: unknown, ancestors: WeakSet<object>): boolean {
  if (input === null || typeof input === "string" || typeof input === "boolean") return true;
  if (typeof input === "number") return Number.isFinite(input);
  if (typeof input !== "object") return false;
  if (ancestors.has(input)) return false;
  ancestors.add(input);
  try {
    if (Array.isArray(input)) return input.every((value) => isJsonValue(value, ancestors));
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(input).every((value) => isJsonValue(value, ancestors));
  } finally {
    ancestors.delete(input);
  }
}
