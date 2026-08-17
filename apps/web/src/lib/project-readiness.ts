import {
  isLoomPortableId,
  isLoomProjectReadinessResponse,
  type LoomProjectReadinessResponse,
} from "@veilquant/loom-protocol";
import { bootstrapDaemonSession, type FetchPort, resolveDaemonOrigin } from "./daemon-auth";

const MAX_PROJECT_READINESS_BYTES = 16_384;

export interface LoadProjectReadinessOptions {
  daemonOrigin: string;
  projectId: string;
  signal?: AbortSignal;
  fetchPort?: FetchPort;
  authorize?: () => Promise<void>;
}

export class ProjectReadinessLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectReadinessLoadError";
  }
}

/** Reads only the daemon's bounded, path-free project summary. */
export async function loadProjectReadiness(
  options: LoadProjectReadinessOptions,
): Promise<LoomProjectReadinessResponse> {
  const daemonOrigin = resolveDaemonOrigin(options.daemonOrigin);
  if (!isLoomPortableId(options.projectId)) {
    throw new ProjectReadinessLoadError("The project identifier is invalid");
  }
  const fetchPort = options.fetchPort ?? globalThis.fetch;
  await (options.authorize ?? (() => bootstrapDaemonSession(daemonOrigin, fetchPort)))();

  let response: Response;
  try {
    response = await fetchPort(
      `${daemonOrigin}/v0/projects/${encodeURIComponent(options.projectId)}`,
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
    throw new ProjectReadinessLoadError("Project readiness could not connect to the daemon", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new ProjectReadinessLoadError("The daemon rejected the project readiness request");
  }
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null && Number(declaredLength) > MAX_PROJECT_READINESS_BYTES) {
    throw new ProjectReadinessLoadError("The project readiness response exceeded its size limit");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PROJECT_READINESS_BYTES) {
    throw new ProjectReadinessLoadError("The project readiness response exceeded its size limit");
  }

  let input: unknown;
  try {
    input = JSON.parse(body) as unknown;
  } catch (error) {
    throw new ProjectReadinessLoadError("The daemon returned malformed project readiness data", {
      cause: error,
    });
  }
  if (!isLoomProjectReadinessResponse(input) || input.projectId !== options.projectId) {
    throw new ProjectReadinessLoadError("The daemon returned unsupported project readiness data");
  }
  return input;
}
