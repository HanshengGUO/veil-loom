import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  isLoomPiRuntimeDescriptor,
  type LoomAcceptedCommandResponse,
  type LoomPiRuntimeDescriptor,
  type LoomProfileDescriptor,
  RAW_PI_PROFILE,
} from "@veilquant/loom-protocol";
import type { SessionEventStore, SessionEventStoreRegistry } from "./event-store.js";
import type { HostedPiSession, PiSessionFactory } from "./pi/deterministic-session.js";
import {
  LOOM_REFERENCE_BACKTEST_TOOL_NAME,
  publishedViewFromToolResult,
} from "./pi/loom-extension.js";

export type RuntimeAdapterErrorCode =
  | "PROFILE_UNAVAILABLE"
  | "SESSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "SESSION_CONFLICT"
  | "TASK_NOT_FOUND"
  | "TASK_NOT_CANCELLABLE"
  | "RUNTIME_UNAVAILABLE";

export class RuntimeAdapterError extends Error {
  readonly code: RuntimeAdapterErrorCode;

  constructor(code: RuntimeAdapterErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeAdapterError";
    this.code = code;
  }
}

export interface RuntimeSession {
  projectId: string;
  sessionId: string;
  profile: "raw-pi";
  runtime: LoomPiRuntimeDescriptor;
}

export interface StartSessionInput {
  projectId: string;
  sessionId: string;
  commandId: string;
  title?: string;
}

export interface SendMessageInput {
  projectId: string;
  sessionId: string;
  commandId: string;
  taskId: string;
  messageId: string;
  content: string;
}

export interface CancelTaskInput {
  projectId: string;
  sessionId: string;
  commandId: string;
  taskId: string;
}

export interface CloseSessionInput {
  projectId: string;
  sessionId: string;
}

export interface LoomRuntimeAdapter {
  readonly descriptor: LoomProfileDescriptor;
  start(input: StartSessionInput): Promise<RuntimeSession>;
  send(input: SendMessageInput): Promise<LoomAcceptedCommandResponse>;
  cancel(input: CancelTaskInput): Promise<LoomAcceptedCommandResponse>;
  close(input: CloseSessionInput): Promise<void>;
  waitForIdle?(projectId: string, sessionId: string): Promise<void>;
}

interface RuntimeState extends RuntimeSession {
  store: SessionEventStore;
  pi: HostedPiSession;
  activeTask: ActiveTask | undefined;
  knownTasks: Set<string>;
}

interface ActiveTask {
  id: string;
  commandId: string;
  messageId: string;
  cancelRequested: boolean;
  acceptingCancel: boolean;
  assistantTurn: number;
  currentAssistant: { id: string; hasText: boolean } | undefined;
  sawAborted: boolean;
  sawError: boolean;
  projectionError: unknown;
  projectionQueue: Promise<void>;
  runPromise: Promise<void>;
}

export interface RawPiRuntimeAdapterOptions {
  eventStores: SessionEventStoreRegistry;
  sessionFactory: PiSessionFactory;
  cwd: string;
  agentDir: string;
}

/** Owns real Pi AgentSession instances and projects their public lifecycle into durable Loom events. */
export class RawPiRuntimeAdapter implements LoomRuntimeAdapter {
  readonly descriptor = RAW_PI_PROFILE;

  readonly #eventStores: SessionEventStoreRegistry;
  readonly #sessionFactory: PiSessionFactory;
  readonly #cwd: string;
  readonly #agentDir: string;
  readonly #sessions = new Map<string, RuntimeState>();
  readonly #starting = new Set<string>();

  constructor(options: RawPiRuntimeAdapterOptions) {
    this.#eventStores = options.eventStores;
    this.#sessionFactory = options.sessionFactory;
    this.#cwd = options.cwd;
    this.#agentDir = options.agentDir;
  }

  async start(input: StartSessionInput): Promise<RuntimeSession> {
    const key = runtimeKey(input.projectId, input.sessionId);
    if (this.#sessions.has(key) || this.#starting.has(key)) {
      throw new RuntimeAdapterError("SESSION_CONFLICT", "The session is already active");
    }
    this.#starting.add(key);

    try {
      const store = await this.#eventStores.get(input.projectId, input.sessionId);
      if ((await store.replay()).length > 0) {
        throw new RuntimeAdapterError(
          "SESSION_CONFLICT",
          "A durable session already exists with this identifier",
        );
      }
      await store.append({
        type: "session.created",
        payload: {
          profile: "raw-pi",
          title: input.title ?? "Raw Pi exploration",
          commandId: input.commandId,
          assurance: {
            format: "loom.assurance.v0",
            state: "exploratory",
            issuer: "loom",
            evidenceRefs: [],
            limitations: ["This session has not been independently verified by Veil."],
          },
        },
      });
      await store.append({
        type: "session.status_changed",
        payload: { status: "starting" },
      });

      let pi: HostedPiSession;
      try {
        pi = await this.#sessionFactory.create({
          projectId: input.projectId,
          sessionId: input.sessionId,
          cwd: this.#cwd,
          agentDir: this.#agentDir,
        });
        if (!isLoomPiRuntimeDescriptor(pi.descriptor)) {
          pi.dispose();
          throw new Error("The Pi runtime descriptor is invalid");
        }
      } catch (error) {
        await store.append({
          type: "session.status_changed",
          payload: {
            status: "failed",
            code: "PI_START_FAILED",
            remedy:
              "Inspect the daemon's private diagnostics and retry with a supported Pi runtime.",
          },
        });
        throw new RuntimeAdapterError(
          "RUNTIME_UNAVAILABLE",
          "The Pi runtime could not be started",
          { cause: error },
        );
      }

      try {
        await store.append({
          type: "session.ready",
          payload: { profile: "raw-pi", runtime: pi.descriptor },
        });
      } catch (error) {
        pi.dispose();
        throw error;
      }

      const state: RuntimeState = {
        projectId: input.projectId,
        sessionId: input.sessionId,
        profile: "raw-pi",
        runtime: pi.descriptor,
        store,
        pi,
        activeTask: undefined,
        knownTasks: new Set(),
      };
      this.#sessions.set(key, state);
      return publicSession(state);
    } finally {
      this.#starting.delete(key);
    }
  }

  async send(input: SendMessageInput): Promise<LoomAcceptedCommandResponse> {
    const state = this.#requireSession(input.projectId, input.sessionId);
    if (state.activeTask !== undefined) {
      throw new RuntimeAdapterError("SESSION_BUSY", "The session already has an active task");
    }

    const task: ActiveTask = {
      id: input.taskId,
      commandId: input.commandId,
      messageId: input.messageId,
      cancelRequested: false,
      acceptingCancel: true,
      assistantTurn: 0,
      currentAssistant: undefined,
      sawAborted: false,
      sawError: false,
      projectionError: undefined,
      projectionQueue: Promise.resolve(),
      runPromise: Promise.resolve(),
    };
    state.activeTask = task;
    state.knownTasks.add(task.id);

    try {
      await state.store.append({
        type: "message.user_appended",
        payload: {
          messageId: input.messageId,
          commandId: input.commandId,
          content: input.content,
        },
      });
      await state.store.append({
        type: "session.status_changed",
        payload: { status: "busy" },
      });
      await state.store.append({
        type: "task.started",
        payload: {
          taskId: input.taskId,
          commandId: input.commandId,
          kind: "pi-prompt",
          label: "Run Raw Pi request",
        },
      });
    } catch (error) {
      state.activeTask = undefined;
      state.knownTasks.delete(task.id);
      throw error;
    }

    task.runPromise = this.#runTask(state, task, input.content);
    void task.runPromise.catch(() => undefined);
    return accepted(input);
  }

  async cancel(input: CancelTaskInput): Promise<LoomAcceptedCommandResponse> {
    const state = this.#requireSession(input.projectId, input.sessionId);
    if (!state.knownTasks.has(input.taskId)) {
      throw new RuntimeAdapterError("TASK_NOT_FOUND", "The task does not belong to this session");
    }
    const task = state.activeTask;
    if (
      task === undefined ||
      task.id !== input.taskId ||
      task.cancelRequested ||
      !task.acceptingCancel
    ) {
      throw new RuntimeAdapterError("TASK_NOT_CANCELLABLE", "The task is not cancellable");
    }

    task.cancelRequested = true;
    try {
      await state.store.append({
        type: "task.cancel_requested",
        payload: { taskId: task.id, commandId: input.commandId },
      });
    } catch (error) {
      task.cancelRequested = false;
      throw error;
    }
    void state.pi.session.abort().catch(() => undefined);
    return accepted(input);
  }

  async close(input: CloseSessionInput): Promise<void> {
    const key = runtimeKey(input.projectId, input.sessionId);
    const state = this.#sessions.get(key);
    if (state === undefined) return;
    if (state.activeTask !== undefined) {
      state.activeTask.cancelRequested = true;
      state.activeTask.acceptingCancel = false;
      await state.pi.session.abort();
      await state.activeTask.runPromise;
    }
    state.pi.dispose();
    this.#sessions.delete(key);
    await state.store.append({
      type: "session.status_changed",
      payload: { status: "closed" },
    });
  }

  async waitForIdle(projectId: string, sessionId: string): Promise<void> {
    const state = this.#requireSession(projectId, sessionId);
    const task = state.activeTask;
    if (task !== undefined) await task.runPromise;
  }

  #requireSession(projectId: string, sessionId: string): RuntimeState {
    const state = this.#sessions.get(runtimeKey(projectId, sessionId));
    if (state === undefined) {
      throw new RuntimeAdapterError("SESSION_NOT_FOUND", "The runtime session was not found");
    }
    return state;
  }

  async #runTask(state: RuntimeState, task: ActiveTask, content: string): Promise<void> {
    const unsubscribe = state.pi.session.subscribe((event) => {
      task.projectionQueue = task.projectionQueue
        .then(async () => {
          if (task.projectionError !== undefined) return;
          await this.#projectPiEvent(state.store, task, event);
        })
        .catch((error: unknown) => {
          task.projectionError ??= error;
        });
    });
    let promptError: unknown;

    try {
      state.pi.preparePrompt({ taskId: task.id });
      await state.pi.session.prompt(content);
    } catch (error) {
      promptError = error;
    }
    await task.projectionQueue;
    task.acceptingCancel = false;
    unsubscribe();

    try {
      if (task.cancelRequested || task.sawAborted) {
        await state.store.append({
          type: "task.cancelled",
          payload: { taskId: task.id },
        });
      } else if (promptError !== undefined || task.projectionError !== undefined || task.sawError) {
        await state.store.append({
          type: "task.failed",
          payload: {
            taskId: task.id,
            code:
              task.projectionError === undefined ? "PI_RUN_FAILED" : "PI_EVENT_PROJECTION_FAILED",
            remedy: "Inspect the daemon's private diagnostics, then retry the request.",
          },
        });
      } else {
        await state.store.append({
          type: "task.completed",
          payload: { taskId: task.id },
        });
      }
      await state.store.append({
        type: "session.status_changed",
        payload: { status: "ready" },
      });
    } finally {
      if (state.activeTask === task) state.activeTask = undefined;
    }
  }

  async #projectPiEvent(
    store: SessionEventStore,
    task: ActiveTask,
    event: AgentSessionEvent,
  ): Promise<void> {
    if (event.type === "message_start" && isAssistantMessage(event.message)) {
      task.assistantTurn += 1;
      task.currentAssistant = {
        id: `${task.id}-assistant-${task.assistantTurn}`,
        hasText: false,
      };
      return;
    }

    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      const current = task.currentAssistant;
      if (current === undefined || event.assistantMessageEvent.delta.length === 0) return;
      await store.append({
        type: "message.assistant_delta",
        payload: {
          messageId: current.id,
          taskId: task.id,
          delta: event.assistantMessageEvent.delta,
        },
      });
      current.hasText = true;
      return;
    }

    if (event.type === "message_end" && isAssistantMessage(event.message)) {
      if (event.message.stopReason === "aborted") task.sawAborted = true;
      if (event.message.stopReason === "error") task.sawError = true;
      const current = task.currentAssistant;
      const content = visibleAssistantText(event.message.content);
      if (current !== undefined && (current.hasText || content.length > 0)) {
        await store.append({
          type: "message.assistant_completed",
          payload: { messageId: current.id, taskId: task.id, content },
        });
      }
      task.currentAssistant = undefined;
      return;
    }

    if (event.type === "tool_execution_start") {
      await store.append({
        type: "tool.started",
        payload: {
          taskId: task.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          label: publicToolLabel(event.toolName),
        },
      });
      return;
    }

    if (event.type === "tool_execution_update") {
      await store.append({
        type: "tool.progress",
        payload: {
          taskId: task.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          label: publicToolLabel(event.toolName),
        },
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      await store.append({
        type: event.isError ? "tool.failed" : "tool.completed",
        payload: {
          taskId: task.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          label: event.isError
            ? `${publicToolLabel(event.toolName)} failed`
            : `${publicToolLabel(event.toolName)} complete`,
        },
      });
      if (event.isError) {
        task.sawError = true;
        return;
      }
      if (event.toolName === LOOM_REFERENCE_BACKTEST_TOOL_NAME && !task.cancelRequested) {
        const view = publishedViewFromToolResult(event.result);
        if (view === undefined || view.taskId !== task.id) {
          throw new Error("The reference backtest tool returned an invalid view descriptor");
        }
        await store.append({ type: "view.published", payload: view });
      }
    }
  }
}

function accepted(input: {
  commandId: string;
  projectId: string;
  sessionId: string;
  taskId?: string;
}): LoomAcceptedCommandResponse {
  return {
    format: "loom.command.accepted.v0",
    commandId: input.commandId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
  };
}

function publicSession(state: RuntimeState): RuntimeSession {
  return {
    projectId: state.projectId,
    sessionId: state.sessionId,
    profile: state.profile,
    runtime: state.runtime,
  };
}

function runtimeKey(projectId: string, sessionId: string): string {
  return `${projectId}\0${sessionId}`;
}

function isAssistantMessage(
  input: unknown,
): input is { role: "assistant"; content: unknown[]; stopReason: string } {
  return (
    input !== null &&
    typeof input === "object" &&
    "role" in input &&
    input.role === "assistant" &&
    "content" in input &&
    Array.isArray(input.content) &&
    "stopReason" in input &&
    typeof input.stopReason === "string"
  );
}

function visibleAssistantText(content: readonly unknown[]): string {
  return content
    .flatMap((block) => {
      if (
        block !== null &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return [block.text];
      }
      return [];
    })
    .join("");
}

function publicToolLabel(toolName: string): string {
  return toolName === LOOM_REFERENCE_BACKTEST_TOOL_NAME ? "Run reference backtest" : "Pi tool";
}
