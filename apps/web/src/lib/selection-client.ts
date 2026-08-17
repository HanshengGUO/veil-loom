import {
  isLoomAcceptedCommandResponse,
  isLoomCreateSelectionRequest,
  type LoomSelectionSeriesKey,
  type LoomTime,
} from "@veilquant/loom-protocol";
import { bootstrapDaemonSession, type FetchPort, resolveDaemonOrigin } from "./daemon-auth";

const MAX_COMMAND_RESPONSE_BYTES = 64 * 1_024;

export class SelectionCommandError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SelectionCommandError";
  }
}

interface CommandOwnership {
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
  fetchPort?: FetchPort;
  authorize?: () => Promise<void>;
}

export interface CreateSelectionOptions extends CommandOwnership {
  viewId: string;
  from: LoomTime;
  until: LoomTime;
  seriesKeys: readonly LoomSelectionSeriesKey[];
}

export interface SendSelectionQuestionOptions extends CommandOwnership {
  selectionId: string;
  content: string;
}

export async function createSelectionContext(options: CreateSelectionOptions): Promise<string> {
  const body = {
    format: "loom.selection.create.v0",
    viewId: options.viewId,
    from: options.from,
    until: options.until,
    seriesKeys: [...options.seriesKeys],
  } as const;
  if (!isLoomCreateSelectionRequest(body)) {
    throw new SelectionCommandError("The selected chart range is invalid");
  }
  const response = await postCommand(
    options,
    `/v0/sessions/${encodeURIComponent(options.sessionId)}/selections`,
    body,
  );
  if (response.selectionId === undefined) {
    throw new SelectionCommandError("The daemon did not return a selection identifier");
  }
  return response.selectionId;
}

export async function sendSelectionQuestion(
  options: SendSelectionQuestionOptions,
): Promise<string> {
  if (options.content.trim().length === 0) {
    throw new SelectionCommandError("The selection question is empty");
  }
  const response = await postCommand(
    options,
    `/v0/sessions/${encodeURIComponent(options.sessionId)}/messages`,
    {
      format: "loom.message.send.v0",
      content: options.content,
      selectionId: options.selectionId,
    },
  );
  if (response.taskId === undefined) {
    throw new SelectionCommandError("The daemon did not return a task identifier");
  }
  return response.taskId;
}

async function postCommand(options: CommandOwnership, path: string, body: unknown) {
  const origin = resolveDaemonOrigin(options.daemonOrigin);
  const fetchPort = options.fetchPort ?? globalThis.fetch;
  await (options.authorize ?? (() => bootstrapDaemonSession(origin, fetchPort)))();
  const query = new URLSearchParams({ projectId: options.projectId });
  let response: Response;
  try {
    response = await fetchPort(`${origin}${path}?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "include",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    throw new SelectionCommandError("The daemon command could not connect", { cause: error });
  }
  if (!response.ok) {
    throw new SelectionCommandError(
      response.status === 404
        ? "The live session or selection is no longer available"
        : "The daemon rejected the selection command",
    );
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_COMMAND_RESPONSE_BYTES) {
    throw new SelectionCommandError("The daemon command response was too large");
  }
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch (error) {
    throw new SelectionCommandError("The daemon returned malformed command data", {
      cause: error,
    });
  }
  if (
    !isLoomAcceptedCommandResponse(input) ||
    input.projectId !== options.projectId ||
    input.sessionId !== options.sessionId
  ) {
    throw new SelectionCommandError("The daemon returned an invalid command receipt");
  }
  return input;
}
