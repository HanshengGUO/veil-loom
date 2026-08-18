import {
  isLoomAcceptedCommandResponse,
  isLoomDigest,
  isLoomExperimentEvidenceResponse,
  isLoomPortableId,
  isLoomProjectExperimentsResponse,
  type LoomAcceptedCommandResponse,
  type LoomExperimentEvidenceResponse,
  type LoomProjectExperimentsResponse,
} from "@veilquant/loom-protocol";
import { bootstrapDaemonSession, type FetchPort, resolveDaemonOrigin } from "./daemon-auth";

const MAXIMUM_EVIDENCE_BYTES = 128 * 1_024;
const MAXIMUM_HISTORY_BYTES = 256 * 1_024;
const MAXIMUM_COMMAND_BYTES = 16 * 1_024;

export class ExperimentClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExperimentClientError";
  }
}

interface ExperimentOwnership {
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
  experimentId: string;
  attemptId: string;
  fetchPort?: FetchPort;
  authorize?: () => Promise<void>;
  signal?: AbortSignal;
}

interface ProjectExperimentOwnership {
  daemonOrigin: string;
  projectId: string;
  fetchPort?: FetchPort;
  authorize?: () => Promise<void>;
  signal?: AbortSignal;
}

export async function fetchProjectExperiments(
  options: ProjectExperimentOwnership,
): Promise<LoomProjectExperimentsResponse> {
  if (!isLoomPortableId(options.projectId)) {
    throw new ExperimentClientError("The project identity is invalid");
  }
  const origin = resolveDaemonOrigin(options.daemonOrigin);
  const fetchPort = options.fetchPort ?? globalThis.fetch;
  await (options.authorize ?? (() => bootstrapDaemonSession(origin, fetchPort)))();
  let response: Response;
  try {
    response = await fetchPort(
      `${origin}/v0/projects/${encodeURIComponent(options.projectId)}/experiments`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        mode: "cors",
        redirect: "error",
        referrerPolicy: "no-referrer",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error) {
    throw new ExperimentClientError("The project Experiment index could not connect", {
      cause: error,
    });
  }
  const input = await boundedJson(response, MAXIMUM_HISTORY_BYTES);
  if (
    !response.ok ||
    !isLoomProjectExperimentsResponse(input) ||
    input.projectId !== options.projectId
  ) {
    throw new ExperimentClientError(
      response.ok
        ? "The daemon returned an invalid Experiment index"
        : "The project Experiment index is unavailable",
    );
  }
  return input;
}

export async function fetchExperimentEvidence(
  options: ExperimentOwnership,
): Promise<LoomExperimentEvidenceResponse> {
  assertOwnership(options);
  const response = await request(options, "GET");
  const input = await boundedJson(response, MAXIMUM_EVIDENCE_BYTES);
  if (
    !response.ok ||
    !isLoomExperimentEvidenceResponse(input) ||
    input.projectId !== options.projectId ||
    input.sessionId !== options.sessionId ||
    input.experimentId !== options.experimentId ||
    input.attemptId !== options.attemptId
  ) {
    throw new ExperimentClientError(
      response.ok
        ? "The daemon returned invalid Experiment evidence"
        : "The Experiment evidence is unavailable",
    );
  }
  return input;
}

export async function reproduceVeilExperiment(
  options: ExperimentOwnership,
): Promise<LoomAcceptedCommandResponse & { readonly taskId: string }> {
  assertOwnership(options);
  const response = await request(options, "POST", {
    format: "loom.experiment.reproduce.v0",
  });
  const input = await boundedJson(response, MAXIMUM_COMMAND_BYTES);
  if (
    !response.ok ||
    !isLoomAcceptedCommandResponse(input) ||
    input.projectId !== options.projectId ||
    input.sessionId !== options.sessionId ||
    typeof input.taskId !== "string"
  ) {
    throw new ExperimentClientError(
      response.ok
        ? "The daemon returned an invalid reproduction receipt"
        : "The Experiment could not be reproduced",
    );
  }
  return { ...input, taskId: input.taskId };
}

function assertOwnership(options: ExperimentOwnership): void {
  if (
    !isLoomPortableId(options.projectId) ||
    !isLoomPortableId(options.sessionId) ||
    !isLoomPortableId(options.attemptId) ||
    !isLoomDigest(options.experimentId)
  ) {
    throw new ExperimentClientError("The Experiment ownership is invalid");
  }
}

async function request(
  options: ExperimentOwnership,
  method: "GET" | "POST",
  body?: unknown,
): Promise<Response> {
  const origin = resolveDaemonOrigin(options.daemonOrigin);
  const fetchPort = options.fetchPort ?? globalThis.fetch;
  await (options.authorize ?? (() => bootstrapDaemonSession(origin, fetchPort)))();
  const query = new URLSearchParams({ projectId: options.projectId });
  const path =
    `/v0/sessions/${encodeURIComponent(options.sessionId)}/experiments/` +
    `${encodeURIComponent(options.experimentId)}${method === "POST" ? "/reproductions" : ""}`;
  try {
    return await fetchPort(`${origin}${path}?${query}`, {
      method,
      ...(method === "POST" ? { headers: { "Content-Type": "application/json" } } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "include",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    throw new ExperimentClientError("The Experiment request could not connect", { cause: error });
  }
}

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new ExperimentClientError("The Experiment response was too large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ExperimentClientError("The daemon returned malformed Experiment data", {
      cause: error,
    });
  }
}
