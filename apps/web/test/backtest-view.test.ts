import type {
  LoomBacktestView,
  LoomBlobRecord,
  LoomBlobReference,
  LoomPublishedViewDescriptor,
} from "@veilquant/loom-protocol";
import { describe, expect, it, vi } from "vitest";
import { loadBacktestViewResources } from "../src/lib/backtest-view";
import { scaleChartValues, svgAreaPath, svgLinePath } from "../src/lib/chart-geometry";

describe("backtest view resource loading", () => {
  it("loads only resources owned by the durable view descriptor", async () => {
    const fixture = resources();
    const fetchPort = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input));
      const value = path.pathname.startsWith("/v0/views/")
        ? fixture.view
        : fixture.blobs.get(path.pathname.split("/").at(-1) ?? "");
      return new Response(JSON.stringify(value), {
        status: value === undefined ? 404 : 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const authorize = vi.fn(async () => undefined);

    const loaded = await loadBacktestViewResources({
      daemonOrigin: "http://127.0.0.1:43120",
      projectId: "project-a",
      sessionId: "session-a",
      descriptor: fixture.descriptor,
      fetchPort,
      authorize,
    });

    expect(authorize).toHaveBeenCalledOnce();
    expect(fetchPort).toHaveBeenCalledTimes(5);
    expect(loaded.market?.points).toHaveLength(2);
    expect(loaded.equity.seriesKey).toBe("equity");
    expect(loaded.trades?.rows[0]).toMatchObject({ side: "buy" });
    for (const [url, init] of fetchPort.mock.calls) {
      expect(String(url)).toContain("projectId=project-a");
      expect(String(url)).toContain("sessionId=session-a");
      expect(init).toMatchObject({ credentials: "include", referrerPolicy: "no-referrer" });
    }
  });

  it("rejects a view that conflicts with its event descriptor before loading blobs", async () => {
    const fixture = resources();
    const fetchPort = vi.fn(async () =>
      Response.json({
        ...fixture.view,
        provenance: { ...fixture.view.provenance, sessionId: "session-b" },
      }),
    );
    await expect(
      loadBacktestViewResources({
        daemonOrigin: "http://127.0.0.1:43120",
        projectId: "project-a",
        sessionId: "session-a",
        descriptor: fixture.descriptor,
        fetchPort,
        authorize: async () => undefined,
      }),
    ).rejects.toThrow("does not match its durable event descriptor");
    expect(fetchPort).toHaveBeenCalledOnce();
  });
});

describe("backtest chart geometry", () => {
  it("scales finite values without embedding data-specific coordinates", () => {
    const scale = scaleChartValues([10, 15, 12], 100, 50, 5);
    expect(scale).toMatchObject({ minimum: 10, maximum: 15 });
    expect(scale.points[0]).toEqual({ x: 5, y: 45 });
    expect(scale.points[1]).toEqual({ x: 50, y: 5 });
    expect(svgLinePath(scale.points)).toBe("M5 45 L50 5 L95 29");
    expect(svgAreaPath(scale.points, 45)).toBe("M5 45 L50 5 L95 29 L95 45 L5 45 Z");
    expect(() => scaleChartValues([Number.NaN], 100, 50)).toThrow("finite series");
  });
});

function resources(): {
  descriptor: LoomPublishedViewDescriptor;
  view: LoomBacktestView;
  blobs: Map<string, LoomBlobRecord>;
} {
  const first = { epoch: "1700000000000", unit: "ms" } as const;
  const second = { epoch: "1700086400000", unit: "ms" } as const;
  const references = {
    market: reference("a", "loom.series.v0", "ohlcv", "market", 2),
    equity: reference("b", "loom.series.v0", "scalar", "equity", 2),
    drawdown: reference("c", "loom.series.v0", "scalar", "drawdown", 2),
    trades: reference("d", "loom.table.v0", "trades", "trades", 1),
  };
  const assurance = {
    format: "loom.assurance.v0",
    state: "exploratory",
    issuer: "loom",
    evidenceRefs: [],
    limitations: ["Not independently verified"],
  } as const;
  const view: LoomBacktestView = {
    format: "loom.backtest-view.v0",
    viewId: `view_${"0".repeat(64)}`,
    title: "Reference backtest",
    summary: "A validated deterministic view.",
    createdAt: "2026-08-18T00:00:00.000Z",
    assurance: { ...assurance, evidenceRefs: [], limitations: [...assurance.limitations] },
    timeRange: { start: first, end: second },
    ...references,
    metrics: [
      {
        key: "total_return",
        label: "Total return",
        value: 0.01,
        unit: "ratio",
        scale: "percent",
        sampleScope: "full-sample",
        method: { id: "endpoint-v0", description: "Net endpoint return." },
      },
    ],
    regions: [],
    provenance: {
      format: "loom.view-provenance.v0",
      projectId: "project-a",
      sessionId: "session-a",
      taskId: "task-a",
      adapter: { id: "loom.reference.daily-factor", version: "0" },
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
    },
  };
  const createdAt = view.createdAt;
  const market: LoomBlobRecord = {
    format: "loom.blob.v0",
    blobId: references.market.blobId,
    createdAt,
    content: {
      format: "loom.series.v0",
      kind: "ohlcv",
      seriesKey: "market",
      timeUnit: "ms",
      points: [
        { time: first, open: 100, high: 102, low: 99, close: 101, volume: 1_000 },
        { time: second, open: 101, high: 103, low: 100, close: 102, volume: 1_100 },
      ],
    },
  };
  const scalar = (
    key: "equity" | "drawdown",
    digest: string,
    values: [number, number],
  ): LoomBlobRecord => ({
    format: "loom.blob.v0",
    blobId: `blob_${digest.repeat(64)}`,
    createdAt,
    content: {
      format: "loom.series.v0",
      kind: "scalar",
      seriesKey: key,
      timeUnit: "ms",
      unit: key === "equity" ? "currency" : "ratio",
      points: [
        { time: first, value: values[0] },
        { time: second, value: values[1] },
      ],
    },
  });
  const trades: LoomBlobRecord = {
    format: "loom.blob.v0",
    blobId: references.trades.blobId,
    createdAt,
    content: {
      format: "loom.table.v0",
      kind: "trades",
      tableKey: "trades",
      timeUnit: "ms",
      rows: [{ tradeId: "trade-a", time: second, side: "buy", price: 101, quantity: 10 }],
    },
  };
  return {
    descriptor: {
      format: "loom.view-published.v0",
      viewId: view.viewId,
      viewFormat: view.format,
      kind: "backtest",
      title: view.title,
      summary: view.summary,
      taskId: "task-a",
      assurance: view.assurance,
    },
    view,
    blobs: new Map([
      [market.blobId, market],
      [references.equity.blobId, scalar("equity", "b", [100_000, 101_000])],
      [references.drawdown.blobId, scalar("drawdown", "c", [0, -0.01])],
      [trades.blobId, trades],
    ]),
  };
}

function reference(
  digest: string,
  contentFormat: LoomBlobReference["contentFormat"],
  kind: LoomBlobReference["kind"],
  key: LoomBlobReference["key"],
  itemCount: number,
): LoomBlobReference {
  return {
    blobId: `blob_${digest.repeat(64)}`,
    contentFormat,
    kind,
    key,
    itemCount,
    byteLength: 100,
  };
}
