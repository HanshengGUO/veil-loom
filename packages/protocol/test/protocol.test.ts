import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  compareLoomTime,
  isLoomAcceptedCommandResponse,
  isLoomAssurance,
  isLoomAuthResponse,
  isLoomBacktestImport,
  isLoomBacktestView,
  isLoomBlobRecord,
  isLoomCancelTaskRequest,
  isLoomCreateSelectionRequest,
  isLoomCreateSessionRequest,
  isLoomEventEnvelope,
  isLoomPiRuntimeDescriptor,
  isLoomPortableId,
  isLoomPublishedViewDescriptor,
  isLoomSelection,
  isLoomSelectionCreatedPayload,
  isLoomSendMessageRequest,
  LOOM_PROFILE_DESCRIPTORS,
  LoomAssuranceSchema,
  type LoomBacktestImport,
  type LoomBlobReference,
  LoomEventEnvelopeSchema,
  LoomProfileDescriptorSchema,
  RAW_PI_PROFILE,
  VEIL_PROFILE,
} from "../src/index.js";

describe("Loom profile protocol", () => {
  it("publishes exact Raw Pi and Veil capability descriptors", () => {
    expect(LOOM_PROFILE_DESCRIPTORS).toEqual([RAW_PI_PROFILE, VEIL_PROFILE]);
    expect(
      LOOM_PROFILE_DESCRIPTORS.every((profile) => Check(LoomProfileDescriptorSchema, profile)),
    ).toBe(true);
    expect(RAW_PI_PROFILE.capabilities).not.toContain("veil-promotion");
    expect(VEIL_PROFILE.capabilities).toContain("veil-reproduction");
  });

  it("rejects unknown profile fields", () => {
    expect(
      Check(LoomProfileDescriptorSchema, {
        ...RAW_PI_PROFILE,
        verified: true,
      }),
    ).toBe(false);
  });
});

describe("Loom event protocol", () => {
  const event = {
    format: "loom.event.v0",
    eventId: "evt_00000000-0000-4000-8000-000000000001",
    projectId: "project-a",
    sessionId: "session-a",
    sequence: 1,
    occurredAt: "2026-08-17T10:00:00.000Z",
    type: "system.notice",
    payload: { message: "ready", progress: 0.5 },
  };

  it("accepts an exact, JSON-safe event envelope", () => {
    expect(Check(LoomEventEnvelopeSchema, event)).toBe(true);
    expect(isLoomEventEnvelope(event)).toBe(true);
    expect(
      isLoomEventEnvelope({
        ...event,
        type: "task.interrupted",
        payload: { taskId: "task-1", code: "DAEMON_RESTART" },
      }),
    ).toBe(true);
  });

  it("rejects non-canonical time, non-finite payloads, and unknown fields", () => {
    expect(isLoomEventEnvelope({ ...event, occurredAt: "2026-08-17" })).toBe(false);
    expect(isLoomEventEnvelope({ ...event, payload: { metric: Number.NaN } })).toBe(false);
    expect(Check(LoomEventEnvelopeSchema, { ...event, verified: true })).toBe(false);
  });

  it("rejects cyclic payloads without throwing", () => {
    const payload: Record<string, unknown> = {};
    payload.self = payload;
    expect(() => isLoomEventEnvelope({ ...event, payload })).not.toThrow();
    expect(isLoomEventEnvelope({ ...event, payload })).toBe(false);
  });

  it("rejects identifiers that could become paths", () => {
    expect(isLoomEventEnvelope({ ...event, sessionId: "../session-a" })).toBe(false);
    expect(isLoomEventEnvelope({ ...event, projectId: "project/a" })).toBe(false);
    expect(isLoomPortableId("project-a_1.0")).toBe(true);
    expect(isLoomPortableId("../project-a")).toBe(false);
  });
});

describe("Loom authentication protocol", () => {
  it("acknowledges a bootstrap without exposing token material", () => {
    expect(isLoomAuthResponse({ format: "loom.auth.v0", status: "ready" })).toBe(true);
    expect(
      isLoomAuthResponse({ format: "loom.auth.v0", status: "ready", token: "must-not-leak" }),
    ).toBe(false);
  });
});

describe("Loom command protocol", () => {
  it("accepts exact create, message, cancel, and accepted-command records", () => {
    expect(
      isLoomCreateSessionRequest({
        format: "loom.session.create.v0",
        profile: "raw-pi",
        title: "Daily factor",
      }),
    ).toBe(true);
    expect(
      isLoomSendMessageRequest({
        format: "loom.message.send.v0",
        content: "Inspect it.",
        selectionId: "selection_1",
      }),
    ).toBe(true);
    expect(isLoomCancelTaskRequest({ format: "loom.task.cancel.v0" })).toBe(true);
    expect(
      isLoomAcceptedCommandResponse({
        format: "loom.command.accepted.v0",
        commandId: "command-1",
        projectId: "project-1",
        sessionId: "session-1",
        taskId: "task-1",
        selectionId: "selection_1",
      }),
    ).toBe(true);
  });

  it("rejects blank content, unknown fields, and non-portable response IDs", () => {
    expect(
      isLoomCreateSessionRequest({
        format: "loom.session.create.v0",
        profile: "raw-pi",
        title: "   ",
      }),
    ).toBe(false);
    expect(
      isLoomSendMessageRequest({
        format: "loom.message.send.v0",
        content: "   ",
        trusted: true,
      }),
    ).toBe(false);
    expect(
      isLoomAcceptedCommandResponse({
        format: "loom.command.accepted.v0",
        commandId: "../command",
        projectId: "project-1",
        sessionId: "session-1",
      }),
    ).toBe(false);
  });

  it("validates a redacted Pi runtime fingerprint without accepting extra details", () => {
    const runtime = {
      format: "loom.pi-runtime.v0",
      package: "@earendil-works/pi-coding-agent",
      version: "0.84.2",
      provider: "loom-offline-fixture",
      model: "loom-fixture-v0",
      mode: "offline-fixture",
      fingerprint: "pi-0.84.2__loom-offline-fixture__loom-fixture-v0",
    };
    expect(isLoomPiRuntimeDescriptor(runtime)).toBe(true);
    expect(isLoomPiRuntimeDescriptor({ ...runtime, apiKey: "must-not-leak" })).toBe(false);
  });
});

describe("Loom selection protocol", () => {
  const from = { epoch: "1700000000000", unit: "ms" } as const;
  const until = { epoch: "1700086400000", unit: "ms" } as const;
  const request = {
    format: "loom.selection.create.v0",
    viewId: `view_${"a".repeat(64)}`,
    from,
    until,
    seriesKeys: ["equity", "drawdown"] as const,
  };
  const selection = {
    format: "loom.selection.v0",
    selectionId: "selection_1",
    projectId: "project-a",
    sessionId: "session-a",
    viewId: request.viewId,
    from,
    until,
    seriesKeys: ["equity", "drawdown"],
    visibleSummary: [
      selectionMetric("selection.net_return", "Net return", 0.01),
      selectionMetric("selection.max_drawdown", "Maximum drawdown", -0.02),
    ],
    createdAt: "2026-08-18T00:00:00.000Z",
  };

  it("accepts an exact range request and daemon-derived selection record", () => {
    expect(isLoomCreateSelectionRequest(request)).toBe(true);
    expect(isLoomSelection(selection)).toBe(true);
    expect(
      isLoomSelectionCreatedPayload({
        format: "loom.selection-created.v0",
        commandId: "command-1",
        selection,
      }),
    ).toBe(true);
  });

  it("rejects injected summaries, mixed units, duplicate series, and forged metric scope", () => {
    expect(isLoomCreateSelectionRequest({ ...request, visibleSummary: [] })).toBe(false);
    expect(isLoomCreateSelectionRequest({ ...request, until: { ...until, unit: "us" } })).toBe(
      false,
    );
    expect(isLoomCreateSelectionRequest({ ...request, seriesKeys: ["equity", "equity"] })).toBe(
      false,
    );
    expect(
      isLoomSelection({
        ...selection,
        visibleSummary: [
          { ...selection.visibleSummary[0], sampleScope: "full-sample" },
          selection.visibleSummary[1],
        ],
      }),
    ).toBe(false);
    expect(
      isLoomSelection({
        ...selection,
        visibleSummary: [
          selectionMetric("selection.market_return", "Market return", 0.01),
          selection.visibleSummary[1],
        ],
      }),
    ).toBe(false);
  });
});

describe("Loom assurance protocol", () => {
  it("allows Loom to issue only evidence-free exploratory assurance", () => {
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "exploratory",
        issuer: "loom",
        evidenceRefs: [],
        limitations: ["Not independently verified"],
      }),
    ).toBe(true);
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "accepted",
        issuer: "loom",
        evidenceRefs: [],
        limitations: [],
      }),
    ).toBe(false);
  });

  it("requires Veil evidence for every non-exploratory state", () => {
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "accepted",
        issuer: "veil",
        evidenceRefs: ["veil-experiment:example"],
        limitations: [],
      }),
    ).toBe(true);
    expect(
      isLoomAssurance({
        format: "loom.assurance.v0",
        state: "rejected",
        issuer: "veil",
        evidenceRefs: [],
        limitations: [],
      }),
    ).toBe(false);
  });

  it("keeps structural schema validation separate from issuer semantics", () => {
    const forged = {
      format: "loom.assurance.v0",
      state: "accepted",
      issuer: "loom",
      evidenceRefs: [],
      limitations: [],
    };
    expect(Check(LoomAssuranceSchema, forged)).toBe(true);
    expect(isLoomAssurance(forged)).toBe(false);
  });
});

describe("Loom backtest view protocol", () => {
  it("validates a bounded import with bigint-safe ordered time and explicit metric semantics", () => {
    const input = backtestImport();
    expect(isLoomBacktestImport(input)).toBe(true);
    expect(
      compareLoomTime(
        { epoch: "1700000000000", unit: "ms" },
        { epoch: "1700000000000000000", unit: "ns" },
      ),
    ).toBe(0);

    expect(
      isLoomBacktestImport({
        ...input,
        equity: [input.equity[1], input.equity[0]],
      }),
    ).toBe(false);
    expect(
      isLoomBacktestImport({
        ...input,
        drawdown: [input.drawdown[0], { ...input.drawdown[1], value: Number.NaN }],
      }),
    ).toBe(false);
    expect(
      isLoomBacktestImport({
        ...input,
        trades: [{ ...input.trades[0], time: { epoch: "1700000000000000", unit: "us" } }],
      }),
    ).toBe(false);
  });

  it("keeps blob records typed and view ownership/provenance explicit", () => {
    const input = backtestImport();
    const marketRecord = {
      format: "loom.blob.v0",
      blobId: `blob_${"a".repeat(64)}`,
      createdAt: "2026-08-18T00:00:00.000Z",
      content: {
        format: "loom.series.v0",
        kind: "ohlcv",
        seriesKey: "market",
        timeUnit: "ms",
        points: input.market,
      },
    };
    expect(isLoomBlobRecord(marketRecord)).toBe(true);
    expect(isLoomBlobRecord({ ...marketRecord, secretPath: "/private/data.csv" })).toBe(false);

    const assurance = {
      format: "loom.assurance.v0",
      state: "exploratory",
      issuer: "loom",
      evidenceRefs: [],
      limitations: ["Not independently verified"],
    } as const;
    const view = {
      format: "loom.backtest-view.v0",
      viewId: `view_${"0".repeat(64)}`,
      title: input.title,
      summary: input.summary,
      createdAt: "2026-08-18T00:00:00.000Z",
      assurance,
      timeRange: { start: input.market[0]?.time, end: input.market[1]?.time },
      market: reference("a", "loom.series.v0", "ohlcv", "market", 2),
      equity: reference("b", "loom.series.v0", "scalar", "equity", 2),
      drawdown: reference("c", "loom.series.v0", "scalar", "drawdown", 2),
      trades: reference("d", "loom.table.v0", "trades", "trades", 1),
      metrics: input.metrics,
      regions: input.regions,
      provenance: {
        format: "loom.view-provenance.v0",
        projectId: "project-a",
        sessionId: "session-a",
        taskId: "task-a",
        adapter: { id: "loom.reference.daily-factor", version: "0" },
        source: input.source,
        run: input.run,
      },
    };
    expect(isLoomBacktestView(view)).toBe(true);

    const descriptor = {
      format: "loom.view-published.v0",
      viewId: view.viewId,
      viewFormat: view.format,
      kind: "backtest",
      title: view.title,
      summary: view.summary,
      taskId: "task-a",
      assurance,
    };
    expect(isLoomPublishedViewDescriptor(descriptor)).toBe(true);
    expect(
      isLoomPublishedViewDescriptor({
        ...descriptor,
        assurance: { ...assurance, state: "accepted" },
      }),
    ).toBe(false);
    expect(isLoomBacktestView({ ...view, viewId: `blob_${"0".repeat(64)}` })).toBe(false);
  });
});

function backtestImport(): LoomBacktestImport {
  const first = { epoch: "1700000000000", unit: "ms" } as const;
  const second = { epoch: "1700086400000", unit: "ms" } as const;
  return {
    format: "loom.backtest-import.v0",
    title: "Reference backtest",
    summary: "Two ordered sessions with explicit net execution semantics.",
    timeUnit: "ms",
    market: [
      { time: first, open: 100, high: 102, low: 99, close: 101, volume: 1_000 },
      { time: second, open: 101, high: 103, low: 100, close: 102, volume: 1_200 },
    ],
    equity: [
      { time: first, value: 100_000 },
      { time: second, value: 101_000 },
    ],
    drawdown: [
      { time: first, value: 0 },
      { time: second, value: 0 },
    ],
    trades: [{ tradeId: "trade-1", time: second, side: "buy", price: 101, quantity: 10 }],
    metrics: [
      {
        key: "total_return",
        label: "Total return",
        value: 0.01,
        unit: "ratio",
        scale: "percent",
        sampleScope: "full-sample",
        method: { id: "endpoint-v0", description: "Endpoint return on net equity." },
      },
    ],
    regions: [],
    source: {
      dataId: "fixture-data",
      dataDigest: `sha256:${"1".repeat(64)}`,
      artifactId: "fixture-artifact",
      artifactDigest: `sha256:${"2".repeat(64)}`,
    },
    run: {
      protocolId: "next-session-open-v0",
      signalLagSessions: 1,
      executionPrice: "open",
      equityBasis: "net",
      costModel: "10 bps round trip",
    },
  };
}

function reference(
  digestCharacter: string,
  contentFormat: LoomBlobReference["contentFormat"],
  kind: LoomBlobReference["kind"],
  key: LoomBlobReference["key"],
  itemCount: number,
): LoomBlobReference {
  return {
    blobId: `blob_${digestCharacter.repeat(64)}`,
    contentFormat,
    kind,
    key,
    itemCount,
    byteLength: 100,
  };
}

function selectionMetric(key: string, label: string, value: number) {
  return {
    key,
    label,
    value,
    unit: "ratio" as const,
    scale: "percent" as const,
    sampleScope: "selection" as const,
    method: { id: "selected-range-v0", description: "Computed over the selected range." },
  };
}
