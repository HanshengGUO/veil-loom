import {
  isLoomAcceptedCommandResponse,
  isLoomCreatePromotionRequest,
  isLoomPortableId,
  isLoomPromotionAcceptedResponse,
  type LoomPromotionAcceptedResponse,
} from "@veilquant/loom-protocol";
import { bootstrapDaemonSession, type FetchPort, resolveDaemonOrigin } from "./daemon-auth";

const MAX_COMMAND_RESPONSE_BYTES = 16_384;

export class PromotionCommandError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PromotionCommandError";
  }
}

interface PromotionCommandOwnership {
  daemonOrigin: string;
  projectId: string;
  fetchPort?: FetchPort;
  authorize?: () => Promise<void>;
  signal?: AbortSignal;
}

export interface CreateVeilPromotionOptions extends PromotionCommandOwnership {
  sourceSessionId: string;
  viewId: string;
  artifactReference: string;
  hypothesisStatement: string;
}

export interface CancelVeilPromotionOptions extends PromotionCommandOwnership {
  sessionId: string;
  taskId: string;
}

export async function createVeilPromotion(
  options: CreateVeilPromotionOptions,
): Promise<LoomPromotionAcceptedResponse> {
  const body = {
    format: "loom.promotion.create.v0",
    viewId: options.viewId,
    artifactReference: options.artifactReference,
    hypothesis: { statement: options.hypothesisStatement },
  } as const;
  if (
    !isLoomPortableId(options.projectId) ||
    !isLoomPortableId(options.sourceSessionId) ||
    !isLoomCreatePromotionRequest(body)
  ) {
    throw new PromotionCommandError("The verification handoff is invalid");
  }
  const input = await postJson(
    options,
    `/v0/sessions/${encodeURIComponent(options.sourceSessionId)}/promotions`,
    body,
  );
  if (
    !isLoomPromotionAcceptedResponse(input) ||
    input.projectId !== options.projectId ||
    input.sourceSessionId !== options.sourceSessionId
  ) {
    throw new PromotionCommandError("The daemon returned an invalid promotion receipt");
  }
  return input;
}

export async function cancelVeilPromotion(options: CancelVeilPromotionOptions): Promise<void> {
  if (
    !isLoomPortableId(options.projectId) ||
    !isLoomPortableId(options.sessionId) ||
    !isLoomPortableId(options.taskId)
  ) {
    throw new PromotionCommandError("The verification task identity is invalid");
  }
  const input = await postJson(
    options,
    `/v0/sessions/${encodeURIComponent(options.sessionId)}/tasks/${encodeURIComponent(options.taskId)}/cancel`,
    { format: "loom.task.cancel.v0" },
  );
  if (
    !isLoomAcceptedCommandResponse(input) ||
    input.projectId !== options.projectId ||
    input.sessionId !== options.sessionId ||
    input.taskId !== options.taskId
  ) {
    throw new PromotionCommandError("The daemon returned an invalid cancellation receipt");
  }
}

async function postJson(
  options: PromotionCommandOwnership,
  path: string,
  body: unknown,
): Promise<unknown> {
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
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    throw new PromotionCommandError("The verification command could not connect", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new PromotionCommandError(
      response.status === 409
        ? "This view or project is not available for a new Veil verification attempt"
        : "The daemon rejected the verification command",
    );
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_COMMAND_RESPONSE_BYTES) {
    throw new PromotionCommandError("The verification command response was too large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new PromotionCommandError("The daemon returned malformed verification data", {
      cause: error,
    });
  }
}
