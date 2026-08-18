import { describe, expect, it, vi } from "vitest";
import { cancelVeilPromotion, createVeilPromotion } from "../src/lib/promotion-client";

const OWNERSHIP = {
  daemonOrigin: "http://127.0.0.1:43120",
  projectId: "project-a",
} as const;

describe("Veil promotion browser client", () => {
  it("sends only the minimal portable handoff and validates the new-session receipt", async () => {
    const authorize = vi.fn(async () => undefined);
    const fetchPort = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        {
          format: "loom.promotion.accepted.v0",
          commandId: "command-1",
          projectId: "project-a",
          sourceSessionId: "raw-session",
          sessionId: "veil-session",
          taskId: "task-1",
          attemptId: "attempt-1",
        },
        { status: 202 },
      ),
    );
    await expect(
      createVeilPromotion({
        ...OWNERSHIP,
        sourceSessionId: "raw-session",
        viewId: `view_${"a".repeat(64)}`,
        artifactReference: "artifact/daily-factor.mjs",
        hypothesisStatement: "The factor survives independent verification.",
        authorize,
        fetchPort,
      }),
    ).resolves.toMatchObject({ sessionId: "veil-session", sourceSessionId: "raw-session" });
    expect(authorize).toHaveBeenCalledOnce();
    const [url, init] = fetchPort.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:43120/v0/sessions/raw-session/promotions?projectId=project-a",
    );
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      format: "loom.promotion.create.v0",
      viewId: `view_${"a".repeat(64)}`,
      artifactReference: "artifact/daily-factor.mjs",
      hypothesis: { statement: "The factor survives independent verification." },
    });
    expect(JSON.stringify(body)).not.toMatch(/metric|sharpe|equity|expected|gate/i);
  });

  it("rejects unsafe artifact references before contacting the daemon", async () => {
    const authorize = vi.fn(async () => undefined);
    const fetchPort = vi.fn(async () => Response.json({}));
    await expect(
      createVeilPromotion({
        ...OWNERSHIP,
        sourceSessionId: "raw-session",
        viewId: `view_${"a".repeat(64)}`,
        artifactReference: "../private/factor.mjs",
        hypothesisStatement: "A valid hypothesis.",
        authorize,
        fetchPort,
      }),
    ).rejects.toThrow("verification handoff is invalid");
    expect(authorize).not.toHaveBeenCalled();
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("rejects a forged target owner and validates cancellation ownership", async () => {
    const forgedFetch = vi.fn(async () =>
      Response.json(
        {
          format: "loom.promotion.accepted.v0",
          commandId: "command-1",
          projectId: "project-a",
          sourceSessionId: "another-source",
          sessionId: "veil-session",
          taskId: "task-1",
          attemptId: "attempt-1",
        },
        { status: 202 },
      ),
    );
    await expect(
      createVeilPromotion({
        ...OWNERSHIP,
        sourceSessionId: "raw-session",
        viewId: `view_${"a".repeat(64)}`,
        artifactReference: "artifact/daily-factor.mjs",
        hypothesisStatement: "A valid hypothesis.",
        authorize: async () => undefined,
        fetchPort: forgedFetch,
      }),
    ).rejects.toThrow("invalid promotion receipt");

    const cancelFetch = vi.fn(async () =>
      Response.json(
        {
          format: "loom.command.accepted.v0",
          commandId: "cancel-1",
          projectId: "project-a",
          sessionId: "veil-session",
          taskId: "task-1",
        },
        { status: 202 },
      ),
    );
    await expect(
      cancelVeilPromotion({
        ...OWNERSHIP,
        sessionId: "veil-session",
        taskId: "task-1",
        authorize: async () => undefined,
        fetchPort: cancelFetch,
      }),
    ).resolves.toBeUndefined();
  });
});
