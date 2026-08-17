import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLoomBacktestImport } from "@veilquant/loom-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DAILY_FACTOR_EXPECTED_IDENTITIES,
  DAILY_FACTOR_IMPORT,
} from "../src/reference-backtest/daily-factor-fixture.js";
import { DailyFactorReferenceAdapter } from "../src/reference-backtest/reference-adapter.js";
import {
  canonicalJson,
  type ResearchArtifactError,
  ResearchArtifactStore,
} from "../src/research-artifacts.js";

describe("daily-factor reference backtest adapter", () => {
  let stateRoot: string;
  let store: ResearchArtifactStore;
  let adapter: DailyFactorReferenceAdapter;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "veil-loom-reference-backtest-"));
    store = new ResearchArtifactStore({ stateRoot });
    adapter = new DailyFactorReferenceAdapter(store);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("keeps the public fixture, source bytes, and built-in normalized import identical", async () => {
    const importBytes = await readFile(fixtureUrl("reference-import.json"), "utf8");
    const publicImport: unknown = JSON.parse(importBytes);
    expect(isLoomBacktestImport(publicImport)).toBe(true);
    expect(canonicalJson(publicImport)).toBe(canonicalJson(DAILY_FACTOR_IMPORT));
    expect(DAILY_FACTOR_IMPORT.source.dataDigest).toBe(
      `sha256:${await fixtureDigest("market.csv")}`,
    );
    expect(DAILY_FACTOR_IMPORT.source.artifactDigest).toBe(
      `sha256:${await fixtureDigest("factor.ts")}`,
    );
  });

  it("publishes deterministic content identities and enforces view/blob ownership", async () => {
    const context = {
      projectId: "project-a",
      sessionId: "session-a",
      taskId: "task-a",
    };
    const first = await adapter.publishCommitted(context);
    const repeated = await adapter.publishCommitted(context);
    expect(repeated).toEqual(first);
    expect(first.viewId).toMatch(/^view_[a-f0-9]{64}$/);

    const view = await store.readView({ ...context, viewId: first.viewId });
    expect(view).toMatchObject({
      assurance: { state: "exploratory", issuer: "loom", evidenceRefs: [] },
      provenance: {
        projectId: "project-a",
        sessionId: "session-a",
        taskId: "task-a",
        adapter: { id: "loom.reference.daily-factor", version: "0" },
        run: { equityBasis: "net", signalLagSessions: 1 },
      },
    });
    const references = [view.market, view.equity, view.drawdown, view.trades].filter(
      (reference) => reference !== null,
    );
    expect(references).toHaveLength(4);
    expect(new Set(references.map((reference) => reference.blobId))).toHaveLength(4);
    for (const reference of references) {
      const record = await store.readBlobForView({
        ...context,
        viewId: first.viewId,
        blobId: reference.blobId,
      });
      expect(record.blobId).toBe(reference.blobId);
    }

    await expect(
      store.readView({ projectId: "project-a", sessionId: "session-b", viewId: first.viewId }),
    ).rejects.toMatchObject({ code: "VIEW_NOT_FOUND" } satisfies Partial<ResearchArtifactError>);
    await expect(
      store.readBlobForView({
        ...context,
        viewId: first.viewId,
        blobId: `blob_${"f".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "BLOB_NOT_FOUND" } satisfies Partial<ResearchArtifactError>);
  });

  it("matches the committed demo view and blob identities", async () => {
    const descriptor = await adapter.publishCommitted({
      projectId: "daily-factor-demo",
      sessionId: "raw-pi-demo",
      taskId: "demo-task-1",
    });
    expect(descriptor.viewId).toBe(DAILY_FACTOR_EXPECTED_IDENTITIES.view);
    const view = await store.readView({
      projectId: "daily-factor-demo",
      sessionId: "raw-pi-demo",
      viewId: descriptor.viewId,
    });
    expect({
      market: view.market?.blobId,
      equity: view.equity.blobId,
      drawdown: view.drawdown?.blobId,
      trades: view.trades?.blobId,
    }).toEqual({
      market: DAILY_FACTOR_EXPECTED_IDENTITIES.market,
      equity: DAILY_FACTOR_EXPECTED_IDENTITIES.equity,
      drawdown: DAILY_FACTOR_EXPECTED_IDENTITIES.drawdown,
      trades: DAILY_FACTOR_EXPECTED_IDENTITIES.trades,
    });
  });

  it("rejects schema drift and corrupt identities before they can be served", async () => {
    const invalid = structuredClone(DAILY_FACTOR_IMPORT);
    invalid.market[1] = { ...invalid.market[1], time: invalid.market[0]?.time } as never;
    await expect(
      adapter.publish(invalid, {
        projectId: "project-a",
        sessionId: "session-a",
        taskId: "task-invalid",
      }),
    ).rejects.toMatchObject({ code: "IMPORT_INVALID" } satisfies Partial<ResearchArtifactError>);

    const published = await adapter.publishCommitted({
      projectId: "project-a",
      sessionId: "session-a",
      taskId: "task-corrupt",
    });
    const path = join(stateRoot, "projects", "project-a", "views", `${published.viewId}.json`);
    const view = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await writeFile(path, canonicalJson({ ...view, summary: "tampered" }), "utf8");
    await expect(
      store.readView({
        projectId: "project-a",
        sessionId: "session-a",
        viewId: published.viewId,
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CORRUPT" } satisfies Partial<ResearchArtifactError>);
  });
});

function fixtureUrl(name: string): URL {
  return new URL(`../../../examples/daily-factor/${name}`, import.meta.url);
}

async function fixtureDigest(name: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(fixtureUrl(name)))
    .digest("hex");
}
