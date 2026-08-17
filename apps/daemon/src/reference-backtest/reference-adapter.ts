import {
  isLoomBacktestImport,
  isLoomPublishedViewDescriptor,
  type LoomAssurance,
  type LoomBacktestImport,
  type LoomBlobContent,
  type LoomPublishedViewDescriptor,
} from "@veilquant/loom-protocol";
import { ResearchArtifactError, type ResearchArtifactStore } from "../research-artifacts.js";
import { DAILY_FACTOR_IMPORT } from "./daily-factor-fixture.js";

export const REFERENCE_BACKTEST_CREATED_AT = "2026-08-18T00:00:00.000Z";

export interface ReferenceBacktestContext {
  projectId: string;
  sessionId: string;
  taskId: string;
  createdAt?: string;
}

/** The sole v0 adapter: an explicit committed import, never an inferred Pi tool result. */
export class DailyFactorReferenceAdapter {
  readonly #artifacts: ResearchArtifactStore;

  constructor(artifacts: ResearchArtifactStore) {
    this.#artifacts = artifacts;
  }

  publishCommitted(context: ReferenceBacktestContext): Promise<LoomPublishedViewDescriptor> {
    return this.publish(DAILY_FACTOR_IMPORT, context);
  }

  async publish(
    candidate: unknown,
    context: ReferenceBacktestContext,
  ): Promise<LoomPublishedViewDescriptor> {
    const input = immutableClone(candidate);
    if (!isLoomBacktestImport(input)) {
      throw new ResearchArtifactError(
        "IMPORT_INVALID",
        "The reference backtest import does not match loom.backtest-import.v0",
      );
    }
    const blobs = normalizeBlobs(input);
    const first = input.market[0];
    const last = input.market.at(-1);
    if (first === undefined || last === undefined) {
      throw new ResearchArtifactError("IMPORT_INVALID", "The reference backtest has no range");
    }
    const assurance: LoomAssurance = {
      format: "loom.assurance.v0",
      state: "exploratory",
      issuer: "loom",
      evidenceRefs: [],
      limitations: [
        "This reference backtest has not been independently verified by Veil.",
        "The committed fixture is illustrative and is not investment advice.",
      ],
    };
    const view = await this.#artifacts.publishBacktestView({
      view: {
        format: "loom.backtest-view.v0",
        title: input.title,
        summary: input.summary,
        createdAt: context.createdAt ?? REFERENCE_BACKTEST_CREATED_AT,
        assurance,
        timeRange: { start: first.time, end: last.time },
        metrics: input.metrics,
        regions: input.regions,
        provenance: {
          format: "loom.view-provenance.v0",
          projectId: context.projectId,
          sessionId: context.sessionId,
          taskId: context.taskId,
          adapter: { id: "loom.reference.daily-factor", version: "0" },
          source: input.source,
          run: input.run,
        },
      },
      blobs,
    });
    const descriptor = {
      format: "loom.view-published.v0",
      viewId: view.viewId,
      viewFormat: view.format,
      kind: "backtest",
      title: view.title,
      summary: view.summary,
      taskId: context.taskId,
      assurance: view.assurance,
    } as const satisfies LoomPublishedViewDescriptor;
    if (!isLoomPublishedViewDescriptor(descriptor)) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "The view descriptor is invalid");
    }
    return descriptor;
  }
}

function normalizeBlobs(input: LoomBacktestImport): LoomBlobContent[] {
  return [
    {
      format: "loom.series.v0",
      kind: "ohlcv",
      seriesKey: "market",
      timeUnit: input.timeUnit,
      points: input.market,
    },
    {
      format: "loom.series.v0",
      kind: "scalar",
      seriesKey: "equity",
      timeUnit: input.timeUnit,
      unit: "currency",
      points: input.equity,
    },
    {
      format: "loom.series.v0",
      kind: "scalar",
      seriesKey: "drawdown",
      timeUnit: input.timeUnit,
      unit: "ratio",
      points: input.drawdown,
    },
    {
      format: "loom.table.v0",
      kind: "trades",
      tableKey: "trades",
      timeUnit: input.timeUnit,
      rows: input.trades,
    },
  ];
}

function immutableClone(input: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(input)) as unknown;
  } catch (error) {
    throw new ResearchArtifactError("IMPORT_INVALID", "The import is not JSON-safe", {
      cause: error,
    });
  }
}
