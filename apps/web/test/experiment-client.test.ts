import { describe, expect, it, vi } from "vitest";
import {
  fetchExperimentEvidence,
  fetchProjectExperiments,
  reproduceVeilExperiment,
} from "../src/lib/experiment-client";

const EXPERIMENT_ID = `sha256:${"2".repeat(64)}`;
const OWNERSHIP = {
  daemonOrigin: "http://127.0.0.1:43120",
  projectId: "project-a",
  sessionId: "veil-session",
  attemptId: "attempt-1",
  experimentId: EXPERIMENT_ID,
} as const;

describe("Experiment evidence browser client", () => {
  it("loads a bounded project index for refresh recovery", async () => {
    const evidence = evidenceFixture();
    const fetchPort = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        format: "loom.project-experiments.v0",
        projectId: "project-a",
        totalCount: 1,
        experiments: [
          {
            sessionId: "veil-session",
            attemptId: "attempt-1",
            commandId: "command-1",
            taskId: "task-1",
            sourceSessionId: "raw-session",
            sourceViewId: `view_${"a".repeat(64)}`,
            experimentId: EXPERIMENT_ID,
            archiveHash: evidence.archiveHash,
            recordedAt: evidence.issuedAt,
            hypothesis: evidence.hypothesis,
            verdict: evidence.verdict,
            claimStatus: evidence.claimStatus,
            registrationStatus: evidence.registrationStatus,
            executionCount: 33,
            assurance: evidence.assurance,
          },
        ],
        truncated: false,
      }),
    );
    await expect(
      fetchProjectExperiments({
        daemonOrigin: OWNERSHIP.daemonOrigin,
        projectId: OWNERSHIP.projectId,
        authorize: async () => undefined,
        fetchPort,
      }),
    ).resolves.toMatchObject({ totalCount: 1 });
    expect(String(fetchPort.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:43120/v0/projects/project-a/experiments",
    );
  });

  it("loads only exact bounded evidence with matching ownership", async () => {
    const authorize = vi.fn(async () => undefined);
    const fetchPort = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(evidenceFixture()),
    );
    await expect(
      fetchExperimentEvidence({ ...OWNERSHIP, authorize, fetchPort }),
    ).resolves.toMatchObject({
      experimentId: EXPERIMENT_ID,
      verdict: "rejected",
      dataset: { id: "daily-factor-prices" },
    });
    expect(authorize).toHaveBeenCalledOnce();
    const [url, init] = fetchPort.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `http://127.0.0.1:43120/v0/sessions/veil-session/experiments/${encodeURIComponent(EXPERIMENT_ID)}?projectId=project-a`,
    );
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("include");
  });

  it("starts an exact reproduction command without expected metrics or verdicts", async () => {
    const fetchPort = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        {
          format: "loom.command.accepted.v0",
          commandId: "command-1",
          projectId: "project-a",
          sessionId: "veil-session",
          taskId: "task-1",
        },
        { status: 202 },
      ),
    );
    await expect(
      reproduceVeilExperiment({
        ...OWNERSHIP,
        authorize: async () => undefined,
        fetchPort,
      }),
    ).resolves.toMatchObject({ taskId: "task-1" });
    const [url, init] = fetchPort.mock.calls[0] ?? [];
    expect(String(url)).toContain("/reproductions?projectId=project-a");
    expect(JSON.parse(String(init?.body))).toEqual({ format: "loom.experiment.reproduce.v0" });
    expect(String(init?.body)).not.toMatch(/metric|verdict|expected|gate/i);
  });

  it("fails closed on forged evidence ownership and reproduction receipts", async () => {
    const forgedEvidence = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ...evidenceFixture(), sessionId: "another-session" }),
    );
    await expect(
      fetchExperimentEvidence({
        ...OWNERSHIP,
        authorize: async () => undefined,
        fetchPort: forgedEvidence,
      }),
    ).rejects.toThrow("invalid Experiment evidence");

    const forgedReceipt = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        {
          format: "loom.command.accepted.v0",
          commandId: "command-1",
          projectId: "another-project",
          sessionId: "veil-session",
          taskId: "task-1",
        },
        { status: 202 },
      ),
    );
    await expect(
      reproduceVeilExperiment({
        ...OWNERSHIP,
        authorize: async () => undefined,
        fetchPort: forgedReceipt,
      }),
    ).rejects.toThrow("invalid reproduction receipt");
  });
});

function evidenceFixture() {
  const archiveHash = `sha256:${"3".repeat(64)}`;
  return {
    format: "loom.experiment-evidence.v0",
    projectId: "project-a",
    sessionId: "veil-session",
    attemptId: "attempt-1",
    experimentId: EXPERIMENT_ID,
    archiveHash,
    issuedAt: "2026-08-18T00:00:00.000Z",
    verdict: "rejected",
    claimStatus: "rejected",
    registrationStatus: "preregistered",
    hypothesis: { ref: "hypothesis:example", statement: "The factor survives verification." },
    dataset: {
      id: "daily-factor-prices",
      version: "2026-08-18",
      declarationHash: digest("4"),
      degradations: [],
    },
    pricingMethod: {
      id: "veil.quantile-close-to-close",
      version: "0.1.0",
      implementationHash: digest("5"),
    },
    costModel: {
      reference: "daily-factor-10bps",
      version: "0.1.0",
      implementationHash: digest("6"),
      configurationHash: digest("7"),
    },
    sample: { observations: 30, periodsPerYear: 252 },
    effectiveTrials: 1,
    metrics: [
      {
        name: "annualized-sharpe",
        scope: "walk-forward-oos",
        basis: "net",
        unit: "ratio",
        value: -0.5,
      },
    ],
    gates: [
      {
        gateId: "cost-availability",
        gateVersion: "0.1.0",
        category: "costs",
        required: true,
        outcome: "passed",
        reasonCode: "COST_EVIDENCE_AVAILABLE",
        implementationHash: digest("8"),
        evidenceHash: digest("9"),
      },
    ],
    rationale: "The complete policy rejected the Experiment.",
    lessons: { totalCount: 1, items: ["Address the failed gate."], truncated: false },
    lineage: {
      artifactHash: digest("a"),
      parameterLockHash: digest("b"),
      planHash: digest("c"),
      contractHash: digest("d"),
      candidateHash: digest("e"),
      pricingHash: digest("f"),
      gateEvaluationHash: digest("1"),
      policyHash: digest("0"),
      tradesHash: digest("a"),
      grossReturnsHash: digest("b"),
      costsHash: digest("c"),
      netReturnsHash: digest("d"),
      readSetSnapshotCount: 30,
    },
    assurance: {
      format: "loom.assurance.v0",
      state: "rejected",
      issuer: "veil",
      evidenceRefs: [EXPERIMENT_ID, archiveHash],
      limitations: ["The source Raw result remains exploratory."],
    },
  } as const;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
