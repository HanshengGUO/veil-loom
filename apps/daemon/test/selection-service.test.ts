import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLoomSelectionCreatedPayload, type LoomBacktestImport } from "@veilquant/loom-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionEventStoreRegistry } from "../src/event-store.js";
import { DAILY_FACTOR_IMPORT } from "../src/reference-backtest/daily-factor-fixture.js";
import { DailyFactorReferenceAdapter } from "../src/reference-backtest/reference-adapter.js";
import { ResearchArtifactStore } from "../src/research-artifacts.js";
import { SelectionService } from "../src/selection-service.js";

describe("selection service", () => {
  let stateRoot: string;
  let eventStores: SessionEventStoreRegistry;
  let artifacts: ResearchArtifactStore;
  let service: SelectionService;
  let viewId: string;
  let nextId: number;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-selection-"));
    artifacts = new ResearchArtifactStore({ stateRoot });
    eventStores = new SessionEventStoreRegistry({
      stateRoot,
      clock: () => "2026-08-18T00:00:00.000Z",
      eventId: () => `event-${++nextId}`,
    });
    nextId = 0;
    service = new SelectionService({
      artifacts,
      eventStores,
      clock: () => "2026-08-18T00:00:00.000Z",
      idSource: (kind) => `${kind}_${kind === "selection" ? "one" : "create"}`,
    });
    viewId = (
      await new DailyFactorReferenceAdapter(artifacts).publishCommitted({
        projectId: "project-a",
        sessionId: "session-a",
        taskId: "task-a",
      })
    ).viewId;
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("derives a bounded summary from canonical blobs and appends it before accepting", async () => {
    const response = await service.create({
      projectId: "project-a",
      sessionId: "session-a",
      request: request(4, 7, ["trades", "drawdown", "market", "equity"]),
    });
    expect(response).toMatchObject({
      commandId: "command_create",
      selectionId: "selection_one",
    });
    const events = await (await eventStores.get("project-a", "session-a")).replay();
    const event = events.at(-1);
    expect(event?.type).toBe("selection.created");
    expect(isLoomSelectionCreatedPayload(event?.payload)).toBe(true);
    if (!isLoomSelectionCreatedPayload(event?.payload)) throw new Error("Expected selection");
    expect(event.payload.selection.seriesKeys).toEqual(["market", "equity", "drawdown", "trades"]);
    expect(
      Object.fromEntries(
        event.payload.selection.visibleSummary.map((metric) => [
          metric.key,
          "value" in metric ? metric.value : metric.text,
        ]),
      ),
    ).toEqual({
      "selection.market_return": 98.2 / 104.6 - 1,
      "selection.net_return": 99_000 / 101_100 - 1,
      "selection.max_drawdown": -0.020772,
      "selection.execution_count": 2,
    });
    await expect(service.resolve("project-a", "session-a", "selection_one")).resolves.toEqual(
      event.payload.selection,
    );
  });

  it("rejects ranges outside the view, non-observation endpoints, and cross-session ownership", async () => {
    await expect(
      service.create({
        projectId: "project-a",
        sessionId: "session-a",
        request: {
          ...request(0, 2, ["equity"]),
          from: { epoch: "1", unit: "ms" },
        },
      }),
    ).rejects.toMatchObject({ code: "SELECTION_INVALID" });
    await expect(
      service.create({
        projectId: "project-a",
        sessionId: "session-a",
        request: {
          ...request(0, 2, ["equity"]),
          from: { epoch: "1704153600001", unit: "ms" },
        },
      }),
    ).rejects.toMatchObject({ code: "SELECTION_INVALID" });
    await expect(
      service.create({
        projectId: "project-a",
        sessionId: "session-b",
        request: request(0, 2, ["equity"]),
      }),
    ).rejects.toMatchObject({ code: "VIEW_NOT_FOUND" });
    await expect(
      service.create({
        projectId: "project-b",
        sessionId: "session-a",
        request: request(0, 2, ["equity"]),
      }),
    ).rejects.toMatchObject({ code: "VIEW_NOT_FOUND" });
    await expect(service.resolve("project-a", "session-b", "selection_one")).rejects.toMatchObject({
      code: "SELECTION_NOT_FOUND",
    });
  });

  it("rejects one-point and mixed-unit ranges", async () => {
    await expect(
      service.create({
        projectId: "project-a",
        sessionId: "session-a",
        request: request(2, 2, ["market"]),
      }),
    ).rejects.toMatchObject({ code: "SELECTION_INVALID" });
    await expect(
      service.create({
        projectId: "project-a",
        sessionId: "session-a",
        request: {
          ...request(0, 2, ["market"]),
          until: { ...dailyTime(2), unit: "us" },
        },
      }),
    ).rejects.toMatchObject({ code: "SELECTION_INVALID" });
  });

  it("rejects a requested series that is not visible in the owned view", async () => {
    const view = await artifacts.readView({
      projectId: "project-a",
      sessionId: "session-a",
      viewId,
    });
    const hiddenDrawdown = new SelectionService({
      artifacts: {
        readView: async () => ({ ...view, drawdown: null }),
        readBlobForView: (input) => artifacts.readBlobForView(input),
      },
      eventStores,
    });
    await expect(
      hiddenDrawdown.create({
        projectId: "project-a",
        sessionId: "session-a",
        request: request(0, 2, ["drawdown"]),
      }),
    ).rejects.toMatchObject({ code: "SELECTION_INVALID" });
  });

  it("rejects a selection larger than the bounded agent context", async () => {
    const large = largeImport(1_025);
    const first = large.market[0];
    const last = large.market.at(-1);
    if (first === undefined || last === undefined) throw new Error("Expected a large fixture");
    const published = await new DailyFactorReferenceAdapter(artifacts).publish(large, {
      projectId: "project-a",
      sessionId: "session-a",
      taskId: "task-large",
    });
    await expect(
      service.create({
        projectId: "project-a",
        sessionId: "session-a",
        request: {
          format: "loom.selection.create.v0",
          viewId: published.viewId,
          from: first.time,
          until: last.time,
          seriesKeys: ["equity"],
        },
      }),
    ).rejects.toMatchObject({ code: "SELECTION_INVALID" });
  });

  function request(
    from: number,
    until: number,
    seriesKeys: ("market" | "equity" | "drawdown" | "trades")[],
  ) {
    return {
      format: "loom.selection.create.v0" as const,
      viewId,
      from: dailyTime(from),
      until: dailyTime(until),
      seriesKeys,
    };
  }
});

function dailyTime(index: number) {
  const point = DAILY_FACTOR_IMPORT.market[index];
  if (point === undefined) throw new Error(`Missing daily-factor point ${index}`);
  return point.time;
}

function largeImport(length: number): LoomBacktestImport {
  const times = Array.from({ length }, (_, index) => ({
    epoch: `${1_700_000_000_000 + index * 86_400_000}`,
    unit: "ms" as const,
  }));
  return {
    ...structuredClone(DAILY_FACTOR_IMPORT),
    market: times.map((time, index) => ({
      time,
      open: 100 + index / 1_000,
      high: 102 + index / 1_000,
      low: 99 + index / 1_000,
      close: 101 + index / 1_000,
      volume: 100_000,
    })),
    equity: times.map((time, index) => ({ time, value: 100_000 + index })),
    drawdown: times.map((time) => ({ time, value: 0 })),
    trades: [],
    regions: [],
  };
}
