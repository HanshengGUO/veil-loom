import {
  isLoomPiRuntimeDescriptor,
  isLoomPortableId,
  type LoomEventEnvelope,
  type LoomPiRuntimeDescriptor,
  type LoomSessionProfile,
} from "@veilquant/loom-protocol";

const MAX_RECOVERY_MESSAGES = 32;
const MAX_RECOVERY_CONTEXT_CHARACTERS = 32_768;

export type SessionRecoveryDisposition = "recover" | "closed" | "failed" | "incomplete";

export interface SessionRecoveryPlan {
  projectId: string;
  sessionId: string;
  profile: LoomSessionProfile;
  title: string;
  disposition: SessionRecoveryDisposition;
  runtime: LoomPiRuntimeDescriptor | undefined;
  knownTaskIds: readonly string[];
  interruptedTaskIds: readonly string[];
  publicContext: string | undefined;
}

export class SessionRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRecoveryError";
  }
}

/** Builds a fail-closed recovery plan from public durable events without guessing task success. */
export function projectSessionRecovery(
  projectId: string,
  sessionId: string,
  events: readonly LoomEventEnvelope[],
): SessionRecoveryPlan {
  if (events.length === 0) throw new SessionRecoveryError("The durable session is empty");
  let profile: LoomSessionProfile | undefined;
  let title = "Recovered Raw Pi session";
  let runtime: LoomPiRuntimeDescriptor | undefined;
  let status = "waiting";
  const tasks = new Map<string, { terminal: boolean }>();
  const messages: Array<{ role: "User" | "Assistant"; content: string }> = [];

  for (const event of events) {
    if (event.projectId !== projectId || event.sessionId !== sessionId) {
      throw new SessionRecoveryError("The durable session has inconsistent ownership");
    }
    if (event.type === "session.created") {
      if (profile !== undefined || event.sequence !== 1) {
        throw new SessionRecoveryError("The durable session has an invalid creation record");
      }
      const candidate = event.payload.profile;
      if (candidate !== "raw-pi" && candidate !== "veil") {
        throw new SessionRecoveryError("The durable session has an unsupported profile");
      }
      profile = candidate;
      if (typeof event.payload.title === "string" && event.payload.title.trim().length > 0) {
        title = event.payload.title;
      }
      status = "creating";
      continue;
    }
    if (profile === undefined) {
      throw new SessionRecoveryError("The durable session has no creation record");
    }
    if (event.type === "session.ready") {
      const candidate = event.payload.runtime;
      if (!isLoomPiRuntimeDescriptor(candidate)) {
        throw new SessionRecoveryError("The durable session has an invalid runtime descriptor");
      }
      if (
        (event.payload.profile !== undefined && event.payload.profile !== profile) ||
        (runtime !== undefined && !sameRuntimeDescriptor(runtime, candidate))
      ) {
        throw new SessionRecoveryError("The durable session changed runtime identity");
      }
      runtime = candidate;
      status = "ready";
      continue;
    }
    if (event.type === "session.status_changed") {
      if (typeof event.payload.status !== "string" || event.payload.status.length === 0) {
        throw new SessionRecoveryError("The durable session has an invalid status record");
      }
      status = event.payload.status;
      continue;
    }
    if (event.type === "task.started") {
      const taskId = requireTaskId(event);
      if (tasks.has(taskId)) {
        throw new SessionRecoveryError("A durable task was started more than once");
      }
      tasks.set(taskId, { terminal: false });
      continue;
    }
    if (event.type === "task.cancel_requested") {
      const task = tasks.get(requireTaskId(event));
      if (task === undefined || task.terminal) {
        throw new SessionRecoveryError("A cancel record does not own an active durable task");
      }
      continue;
    }
    if (
      event.type === "task.completed" ||
      event.type === "task.failed" ||
      event.type === "task.cancelled" ||
      event.type === "task.interrupted"
    ) {
      const task = tasks.get(requireTaskId(event));
      if (task === undefined || task.terminal) {
        throw new SessionRecoveryError("A durable task has an invalid terminal record");
      }
      task.terminal = true;
      continue;
    }
    if (event.type === "message.user_appended") {
      addPublicMessage(messages, "User", event.payload.content);
      continue;
    }
    if (event.type === "message.assistant_completed") {
      addPublicMessage(messages, "Assistant", event.payload.content);
    }
  }

  if (profile === undefined) throw new SessionRecoveryError("The durable session has no profile");
  const knownTaskIds = [...tasks.keys()];
  const interruptedTaskIds = [...tasks]
    .filter(([, task]) => !task.terminal)
    .map(([taskId]) => taskId);
  const disposition: SessionRecoveryDisposition =
    status === "closed"
      ? "closed"
      : status === "failed"
        ? "failed"
        : runtime === undefined
          ? "incomplete"
          : "recover";
  if ((disposition === "closed" || disposition === "failed") && interruptedTaskIds.length > 0) {
    throw new SessionRecoveryError("A terminal durable session still owns an active task");
  }
  return {
    projectId,
    sessionId,
    profile,
    title,
    disposition,
    runtime,
    knownTaskIds,
    interruptedTaskIds,
    publicContext: buildPublicContext(messages),
  };
}

function sameRuntimeDescriptor(
  expected: LoomPiRuntimeDescriptor,
  actual: LoomPiRuntimeDescriptor,
): boolean {
  return (
    expected.format === actual.format &&
    expected.package === actual.package &&
    expected.version === actual.version &&
    expected.provider === actual.provider &&
    expected.model === actual.model &&
    expected.mode === actual.mode &&
    expected.fingerprint === actual.fingerprint
  );
}

function requireTaskId(event: LoomEventEnvelope): string {
  const taskId = event.payload.taskId;
  if (!isLoomPortableId(taskId)) {
    throw new SessionRecoveryError("A durable task has an invalid identifier");
  }
  return taskId;
}

function addPublicMessage(
  messages: Array<{ role: "User" | "Assistant"; content: string }>,
  role: "User" | "Assistant",
  input: unknown,
): void {
  if (typeof input !== "string" || input.length === 0) return;
  messages.push({ role, content: input });
  if (messages.length > MAX_RECOVERY_MESSAGES) messages.shift();
}

function buildPublicContext(
  messages: readonly { role: "User" | "Assistant"; content: string }[],
): string | undefined {
  if (messages.length === 0) return undefined;
  const prefix =
    "Loom reconstructed this prior public transcript after a daemon restart. It may omit private tool context; do not infer that an interrupted task succeeded.";
  const selected: string[] = [];
  let length = prefix.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    const line = `${message.role}: ${message.content}`;
    const available = MAX_RECOVERY_CONTEXT_CHARACTERS - length - 1;
    if (available <= 0) break;
    selected.unshift(line.slice(Math.max(0, line.length - available)));
    length += Math.min(line.length, available) + 1;
  }
  return [prefix, ...selected].join("\n");
}
