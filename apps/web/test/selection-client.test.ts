import { describe, expect, it, vi } from "vitest";
import { createSelectionContext, sendSelectionQuestion } from "../src/lib/selection-client";

describe("selection command client", () => {
  it("submits only view-local range fields with cookie credentials", async () => {
    const fetchPort = vi.fn(async () =>
      Response.json(
        {
          format: "loom.command.accepted.v0",
          commandId: "command-one",
          projectId: "project-a",
          sessionId: "session-a",
          selectionId: "selection_one",
        },
        { status: 202 },
      ),
    );
    const authorize = vi.fn(async () => undefined);
    await expect(
      createSelectionContext({
        daemonOrigin: "http://127.0.0.1:43120",
        projectId: "project-a",
        sessionId: "session-a",
        viewId: `view_${"a".repeat(64)}`,
        from: { epoch: "1700000000000", unit: "ms" },
        until: { epoch: "1700086400000", unit: "ms" },
        seriesKeys: ["equity", "drawdown"],
        fetchPort,
        authorize,
      }),
    ).resolves.toBe("selection_one");
    expect(authorize).toHaveBeenCalledOnce();
    const call = fetchPort.mock.calls[0];
    if (call === undefined) throw new Error("Expected a selection request");
    const [url, init] = call;
    expect(url).toBe("http://127.0.0.1:43120/v0/sessions/session-a/selections?projectId=project-a");
    expect(init).toMatchObject({ method: "POST", credentials: "include", mode: "cors" });
    expect(JSON.parse(String(init?.body))).toEqual({
      format: "loom.selection.create.v0",
      viewId: `view_${"a".repeat(64)}`,
      from: { epoch: "1700000000000", unit: "ms" },
      until: { epoch: "1700086400000", unit: "ms" },
      seriesKeys: ["equity", "drawdown"],
    });
    expect(String(init?.body)).not.toContain("summary");
  });

  it("round-trips a durable selection ID into a message command", async () => {
    const fetchPort = vi.fn(async () =>
      Response.json(
        {
          format: "loom.command.accepted.v0",
          commandId: "command-two",
          projectId: "project-a",
          sessionId: "session-a",
          taskId: "task-two",
        },
        { status: 202 },
      ),
    );
    await expect(
      sendSelectionQuestion({
        daemonOrigin: "http://127.0.0.1:43120",
        projectId: "project-a",
        sessionId: "session-a",
        selectionId: "selection_one",
        content: "Why did this interval draw down?",
        fetchPort,
        authorize: async () => undefined,
      }),
    ).resolves.toBe("task-two");
    const init = fetchPort.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      format: "loom.message.send.v0",
      content: "Why did this interval draw down?",
      selectionId: "selection_one",
    });
  });

  it("fails closed on ownership-mismatched receipts", async () => {
    await expect(
      createSelectionContext({
        daemonOrigin: "http://127.0.0.1:43120",
        projectId: "project-a",
        sessionId: "session-a",
        viewId: `view_${"a".repeat(64)}`,
        from: { epoch: "1", unit: "ms" },
        until: { epoch: "2", unit: "ms" },
        seriesKeys: ["equity"],
        authorize: async () => undefined,
        fetchPort: async () =>
          Response.json(
            {
              format: "loom.command.accepted.v0",
              commandId: "command-one",
              projectId: "project-b",
              sessionId: "session-a",
              selectionId: "selection_one",
            },
            { status: 202 },
          ),
      }),
    ).rejects.toThrow(/invalid command receipt/);
  });
});
