import {
  isLoomPiRuntimeDescriptor,
  isLoomPublishedViewDescriptor,
  isLoomSelectionCreatedPayload,
  isLoomVeilExperimentRecordedPayload,
  isLoomVeilStageChangedPayload,
  isLoomVeilVerificationStartedPayload,
  type LoomEventEnvelope,
  type LoomPiRuntimeDescriptor,
  type LoomPublishedViewDescriptor,
  type LoomSelection,
  type LoomSessionProfile,
  type LoomVeilExperimentRecordedPayload,
  type LoomVeilStageChangedPayload,
  type LoomVeilVerificationStartedPayload,
} from "@veilquant/loom-protocol";

export interface ConversationEntry {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
  complete: boolean;
  sequence: number;
}

export interface TaskProjection {
  id: string;
  label: string;
  status: "running" | "cancel-requested" | "cancelled" | "completed" | "failed" | "interrupted";
  sequence: number;
}

export interface ViewProjection extends LoomPublishedViewDescriptor {
  sequence: number;
}

export interface VeilAttemptProjection {
  verification: LoomVeilVerificationStartedPayload;
  stage: LoomVeilStageChangedPayload | undefined;
  experiment: LoomVeilExperimentRecordedPayload | undefined;
}

export type SessionStreamIssue =
  | {
      kind: "gap";
      expectedSequence: number;
      receivedSequence: number;
      message: string;
    }
  | {
      kind: "conflict" | "ownership" | "protocol";
      message: string;
    };

export interface SessionProjection {
  projectId: string;
  sessionId: string;
  lastSequence: number;
  eventIds: readonly string[];
  eventSignatures: readonly string[];
  profile: LoomSessionProfile | undefined;
  runtime: LoomPiRuntimeDescriptor | undefined;
  status: string;
  conversation: readonly ConversationEntry[];
  tasks: readonly TaskProjection[];
  activeView: ViewProjection | undefined;
  activeSelection: LoomSelection | undefined;
  veilAttempt: VeilAttemptProjection | undefined;
  lastActivity: string | undefined;
  issue: SessionStreamIssue | undefined;
}

export type ApplyEventOutcome = "applied" | "duplicate" | "gap" | "rejected";

export interface ApplyEventResult {
  state: SessionProjection;
  outcome: ApplyEventOutcome;
}

export function createSessionProjection(projectId: string, sessionId: string): SessionProjection {
  return {
    projectId,
    sessionId,
    lastSequence: 0,
    eventIds: [],
    eventSignatures: [],
    profile: undefined,
    runtime: undefined,
    status: "waiting",
    conversation: [],
    tasks: [],
    activeView: undefined,
    activeSelection: undefined,
    veilAttempt: undefined,
    lastActivity: undefined,
    issue: undefined,
  };
}

export function applySessionEvent(
  state: SessionProjection,
  event: LoomEventEnvelope,
): ApplyEventResult {
  if (event.projectId !== state.projectId || event.sessionId !== state.sessionId) {
    return rejected(state, {
      kind: "ownership",
      message: "The stream returned an event for another session.",
    });
  }

  if (event.sequence <= state.lastSequence) {
    if (
      state.eventIds[event.sequence - 1] === event.eventId &&
      state.eventSignatures[event.sequence - 1] === eventSignature(event)
    ) {
      return { state, outcome: "duplicate" };
    }
    return rejected(state, {
      kind: "conflict",
      message: `Sequence ${event.sequence} was reused by a different event.`,
    });
  }

  if (state.eventIds.includes(event.eventId)) {
    return rejected(state, {
      kind: "conflict",
      message: `Event ID ${event.eventId} was reused at a new sequence.`,
    });
  }

  const expectedSequence = state.lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    return {
      state: {
        ...state,
        issue: {
          kind: "gap",
          expectedSequence,
          receivedSequence: event.sequence,
          message: `Waiting for event ${expectedSequence}; received ${event.sequence}.`,
        },
      },
      outcome: "gap",
    };
  }

  let next: SessionProjection = {
    ...state,
    lastSequence: event.sequence,
    eventIds: [...state.eventIds, event.eventId],
    eventSignatures: [...state.eventSignatures, eventSignature(event)],
    issue: undefined,
  };

  switch (event.type) {
    case "session.created": {
      const profile = sessionProfile(event.payload.profile);
      next = {
        ...next,
        status: "creating",
        ...(profile === undefined ? {} : { profile }),
      };
      break;
    }
    case "session.ready": {
      const runtime = isLoomPiRuntimeDescriptor(event.payload.runtime)
        ? event.payload.runtime
        : undefined;
      next = { ...next, status: "ready", ...(runtime === undefined ? {} : { runtime }) };
      break;
    }
    case "session.status_changed": {
      const status = stringField(event.payload.status);
      if (status !== undefined) next = { ...next, status };
      break;
    }
    case "message.user_appended": {
      const content = stringField(event.payload.content);
      if (content !== undefined) {
        next = {
          ...next,
          conversation: upsertConversation(next.conversation, {
            id: stringField(event.payload.messageId) ?? event.eventId,
            role: "user",
            content,
            complete: true,
            sequence: event.sequence,
          }),
        };
      }
      break;
    }
    case "message.assistant_delta": {
      const messageId = stringField(event.payload.messageId);
      const delta = stringField(event.payload.delta);
      if (messageId !== undefined && delta !== undefined) {
        next = {
          ...next,
          conversation: appendAssistantDelta(next.conversation, messageId, delta, event.sequence),
        };
      }
      break;
    }
    case "message.assistant_completed": {
      const messageId = stringField(event.payload.messageId) ?? event.eventId;
      const existing = next.conversation.find((entry) => entry.id === messageId);
      const content = stringField(event.payload.content) ?? existing?.content;
      if (content !== undefined) {
        next = {
          ...next,
          conversation: upsertConversation(next.conversation, {
            id: messageId,
            role: "assistant",
            content,
            complete: true,
            sequence: event.sequence,
          }),
        };
      }
      break;
    }
    case "task.started":
      next = updateTask(next, event, "running");
      break;
    case "task.cancel_requested":
      next = updateTask(next, event, "cancel-requested");
      break;
    case "task.cancelled":
      if (invalidVeilTerminal(next, event, false)) {
        return rejected(state, {
          kind: "protocol",
          message: "The Veil verification terminal conflicts with its Experiment evidence.",
        });
      }
      next = updateTask(next, event, "cancelled");
      break;
    case "task.completed":
      if (invalidVeilTerminal(next, event, true)) {
        return rejected(state, {
          kind: "protocol",
          message: "The Veil verification completed without matching Experiment evidence.",
        });
      }
      next = updateTask(next, event, "completed");
      break;
    case "task.failed":
      if (invalidVeilTerminal(next, event, false)) {
        return rejected(state, {
          kind: "protocol",
          message: "The Veil verification terminal conflicts with its Experiment evidence.",
        });
      }
      next = updateTask(next, event, "failed");
      break;
    case "task.interrupted":
      if (invalidVeilTerminal(next, event, false)) {
        return rejected(state, {
          kind: "protocol",
          message: "The Veil verification terminal conflicts with its Experiment evidence.",
        });
      }
      next = updateTask(next, event, "interrupted");
      break;
    case "view.published": {
      if (!isLoomPublishedViewDescriptor(event.payload)) {
        return rejected(state, {
          kind: "protocol",
          message: "The stream returned an invalid published-view descriptor.",
        });
      }
      next = {
        ...next,
        activeView: {
          ...event.payload,
          sequence: event.sequence,
        },
      };
      break;
    }
    case "view.superseded":
      if (stringField(event.payload.viewId) === next.activeView?.viewId) {
        next = { ...next, activeView: undefined, activeSelection: undefined };
      }
      break;
    case "selection.created": {
      if (!isLoomSelectionCreatedPayload(event.payload)) {
        return rejected(state, {
          kind: "protocol",
          message: "The stream returned an invalid selection record.",
        });
      }
      const selection = event.payload.selection;
      if (
        selection.projectId !== state.projectId ||
        selection.sessionId !== state.sessionId ||
        selection.viewId !== next.activeView?.viewId
      ) {
        return rejected(state, {
          kind: "ownership",
          message: "The stream returned a selection for another research view.",
        });
      }
      next = { ...next, activeSelection: selection };
      break;
    }
    case "veil.verification_started": {
      if (
        !isLoomVeilVerificationStartedPayload(event.payload) ||
        next.profile !== "veil" ||
        event.payload.source.sessionId === state.sessionId ||
        next.veilAttempt !== undefined ||
        !taskHasStatus(next, event.payload.taskId, "running")
      ) {
        return rejected(state, {
          kind: "protocol",
          message: "The stream returned an invalid Veil verification attempt.",
        });
      }
      next = {
        ...next,
        veilAttempt: {
          verification: event.payload,
          stage: undefined,
          experiment: undefined,
        },
        lastActivity: "Veil verification started",
      };
      break;
    }
    case "veil.stage_changed": {
      if (!isLoomVeilStageChangedPayload(event.payload)) {
        return rejected(state, {
          kind: "protocol",
          message: "The stream returned an invalid Veil verification stage.",
        });
      }
      const attempt = next.veilAttempt;
      if (
        attempt === undefined ||
        event.payload.attemptId !== attempt.verification.attemptId ||
        event.payload.taskId !== attempt.verification.taskId ||
        !taskHasStatus(next, event.payload.taskId, "running", "cancel-requested") ||
        !validVeilStageTransition(attempt.stage, event.payload)
      ) {
        return rejected(state, {
          kind: "protocol",
          message: "The Veil verification stage is out of order.",
        });
      }
      next = {
        ...next,
        veilAttempt: { ...attempt, stage: event.payload },
        lastActivity:
          event.payload.stage === "development-data"
            ? "Development data read complete"
            : `Independent verification ${event.payload.status}`,
      };
      break;
    }
    case "veil.experiment_recorded": {
      if (!isLoomVeilExperimentRecordedPayload(event.payload)) {
        return rejected(state, {
          kind: "protocol",
          message: "The stream returned invalid Veil Experiment evidence.",
        });
      }
      const attempt = next.veilAttempt;
      if (
        attempt === undefined ||
        attempt.experiment !== undefined ||
        attempt.stage?.stage !== "independent-verification" ||
        attempt.stage.status !== "completed" ||
        event.payload.attemptId !== attempt.verification.attemptId ||
        event.payload.taskId !== attempt.verification.taskId ||
        !taskHasStatus(next, event.payload.taskId, "running")
      ) {
        return rejected(state, {
          kind: "protocol",
          message: "The Veil Experiment does not belong to the active verification attempt.",
        });
      }
      next = {
        ...next,
        veilAttempt: { ...attempt, experiment: event.payload },
        lastActivity: `Veil Experiment ${event.payload.verdict}`,
      };
      break;
    }
    case "tool.started":
    case "tool.progress":
    case "tool.completed":
    case "tool.failed":
      next = {
        ...next,
        lastActivity:
          stringField(event.payload.label) ??
          stringField(event.payload.toolName) ??
          event.type.replace("tool.", "Tool "),
      };
      break;
    case "system.notice": {
      const content = stringField(event.payload.message);
      if (content !== undefined) {
        next = {
          ...next,
          conversation: upsertConversation(next.conversation, {
            id: event.eventId,
            role: "notice",
            content,
            complete: true,
            sequence: event.sequence,
          }),
        };
      }
      break;
    }
  }

  return { state: next, outcome: "applied" };
}

export function withProtocolIssue(state: SessionProjection, message: string): SessionProjection {
  return { ...state, issue: { kind: "protocol", message } };
}

function rejected(state: SessionProjection, issue: SessionStreamIssue): ApplyEventResult {
  return { state: { ...state, issue }, outcome: "rejected" };
}

function updateTask(
  state: SessionProjection,
  event: LoomEventEnvelope,
  status: TaskProjection["status"],
): SessionProjection {
  const taskId = stringField(event.payload.taskId);
  if (taskId === undefined) return state;
  const existing = state.tasks.find((task) => task.id === taskId);
  const task: TaskProjection = {
    id: taskId,
    label: stringField(event.payload.label) ?? existing?.label ?? "Research task",
    status,
    sequence: event.sequence,
  };
  return {
    ...state,
    tasks: [...state.tasks.filter((candidate) => candidate.id !== taskId), task],
  };
}

function upsertConversation(
  entries: readonly ConversationEntry[],
  next: ConversationEntry,
): readonly ConversationEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  return entries.map((entry, entryIndex) => (entryIndex === index ? next : entry));
}

function appendAssistantDelta(
  entries: readonly ConversationEntry[],
  messageId: string,
  delta: string,
  sequence: number,
): readonly ConversationEntry[] {
  const existing = entries.find((entry) => entry.id === messageId);
  return upsertConversation(entries, {
    id: messageId,
    role: "assistant",
    content: `${existing?.content ?? ""}${delta}`,
    complete: false,
    sequence,
  });
}

function sessionProfile(input: unknown): LoomSessionProfile | undefined {
  return input === "raw-pi" || input === "veil" ? input : undefined;
}

function stringField(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function validVeilStageTransition(
  previous: LoomVeilStageChangedPayload | undefined,
  next: LoomVeilStageChangedPayload,
): boolean {
  if (previous === undefined) {
    return next.stage === "development-data" && next.status === "completed";
  }
  if (previous.stage === "development-data") {
    return next.stage === "independent-verification" && next.status === "running";
  }
  return (
    previous.status === "running" && next.stage === previous.stage && next.status === "completed"
  );
}

function taskHasStatus(
  state: SessionProjection,
  taskId: string,
  ...statuses: readonly TaskProjection["status"][]
): boolean {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  return task !== undefined && statuses.includes(task.status);
}

function invalidVeilTerminal(
  state: SessionProjection,
  event: LoomEventEnvelope,
  expectsExperiment: boolean,
): boolean {
  const taskId = stringField(event.payload.taskId);
  const attempt = state.veilAttempt;
  return (
    taskId !== undefined &&
    attempt?.verification.taskId === taskId &&
    (expectsExperiment ? attempt.experiment === undefined : attempt.experiment !== undefined)
  );
}

function eventSignature(event: LoomEventEnvelope): string {
  return JSON.stringify(sortJson(event));
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortJson);
  if (input === null || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => [key, sortJson(value)]),
  );
}
