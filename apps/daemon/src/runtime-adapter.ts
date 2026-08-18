import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  isLoomPiRuntimeDescriptor,
  isLoomVeilExperimentRecordedPayload,
  isLoomVeilReproductionCompletedPayload,
  isLoomVeilStageChangedPayload,
  isLoomVeilVerificationStartedPayload,
  type LoomAcceptedCommandResponse,
  type LoomPiRuntimeDescriptor,
  type LoomProfileDescriptor,
  type LoomSelection,
  type LoomSessionProfile,
  RAW_PI_PROFILE,
  VEIL_PROFILE,
} from "@veilquant/loom-protocol";
import type { SessionEventStore, SessionEventStoreRegistry } from "./event-store.js";
import type { OwnedExperiment } from "./experiments.js";
import type { HostedPiSession, PiSessionFactory } from "./pi/deterministic-session.js";
import {
  LOOM_REFERENCE_BACKTEST_TOOL_NAME,
  publishedViewFromToolResult,
} from "./pi/loom-extension.js";
import { LoomProjectRegistry, type VeilProjectContext } from "./project-readiness.js";
import {
  DAILY_FACTOR_DECISION_SCHEDULE,
  type PreparedPromotion,
  writeDailyFactorPromotionRequest,
} from "./promotion.js";
import type { SessionRecoveryPlan } from "./session-recovery.js";
import type {
  VeilBacktestSuccess,
  VeilDataToolResult,
  VeilExperimentArchive,
  VeilExperimentReproduction,
  VeilHypothesisEntry,
} from "./veil-api.js";

type CompleteVeilBacktestResult = VeilBacktestSuccess & {
  readonly experimentId: string;
  readonly verdict: "accepted" | "degraded" | "rejected";
  readonly experimentArchiveReference: string;
};

export type RuntimeAdapterErrorCode =
  | "PROFILE_UNAVAILABLE"
  | "PROJECT_NOT_READY"
  | "SESSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "SESSION_CONFLICT"
  | "TASK_NOT_FOUND"
  | "TASK_NOT_CANCELLABLE"
  | "PROMOTION_NOT_AVAILABLE"
  | "EXPERIMENT_NOT_FOUND"
  | "EXPERIMENT_UNAVAILABLE"
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
  profile: LoomSessionProfile;
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
  selection?: LoomSelection;
}

export interface CancelTaskInput {
  projectId: string;
  sessionId: string;
  commandId: string;
  taskId: string;
}

export interface StartPromotionInput {
  projectId: string;
  sessionId: string;
  commandId: string;
  taskId: string;
  attemptId: string;
  promotion: PreparedPromotion;
}

export interface StartReproductionInput {
  projectId: string;
  sessionId: string;
  commandId: string;
  taskId: string;
  experiment: OwnedExperiment;
}

export interface CloseSessionInput {
  projectId: string;
  sessionId: string;
}

export interface LoomRuntimeAdapter {
  readonly descriptor: LoomProfileDescriptor;
  start(input: StartSessionInput): Promise<RuntimeSession>;
  recover(input: SessionRecoveryPlan): Promise<RuntimeSession | undefined>;
  send(input: SendMessageInput): Promise<LoomAcceptedCommandResponse>;
  promote(input: StartPromotionInput): Promise<void>;
  reproduce(input: StartReproductionInput): Promise<void>;
  cancel(input: CancelTaskInput): Promise<LoomAcceptedCommandResponse>;
  close(input: CloseSessionInput): Promise<void>;
  waitForIdle?(projectId: string, sessionId: string): Promise<void>;
}

interface RuntimeState extends RuntimeSession {
  store: SessionEventStore;
  pi: HostedPiSession;
  project: RuntimeProjectContext;
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
  abort: () => Promise<void>;
}

export interface PiRuntimeAdapterOptions {
  eventStores: SessionEventStoreRegistry;
  sessionFactory: PiSessionFactory;
  cwd: string;
  agentDir: string;
  descriptor: LoomProfileDescriptor;
  projects?: LoomProjectRegistry;
}

/** Owns real Pi AgentSession instances and projects their public lifecycle into durable Loom events. */
export class PiRuntimeAdapter implements LoomRuntimeAdapter {
  readonly descriptor: LoomProfileDescriptor;

  readonly #eventStores: SessionEventStoreRegistry;
  readonly #sessionFactory: PiSessionFactory;
  readonly #agentDir: string;
  readonly #projects: LoomProjectRegistry;
  readonly #sessions = new Map<string, RuntimeState>();
  readonly #starting = new Set<string>();

  constructor(options: PiRuntimeAdapterOptions) {
    this.descriptor = options.descriptor;
    this.#eventStores = options.eventStores;
    this.#sessionFactory = options.sessionFactory;
    this.#agentDir = options.agentDir;
    this.#projects = options.projects ?? new LoomProjectRegistry({ fallbackRoot: options.cwd });
  }

  async start(input: StartSessionInput): Promise<RuntimeSession> {
    const key = runtimeKey(input.projectId, input.sessionId);
    if (this.#sessions.has(key) || this.#starting.has(key)) {
      throw new RuntimeAdapterError("SESSION_CONFLICT", "The session is already active");
    }
    this.#starting.add(key);

    try {
      const project = await this.#project(input.projectId);
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
          profile: this.descriptor.id,
          title: input.title ?? `${this.descriptor.label} exploration`,
          commandId: input.commandId,
          assurance: {
            format: "loom.assurance.v0",
            state: "exploratory",
            issuer: "loom",
            evidenceRefs: [],
            limitations: [profileLimitation(this.descriptor.id)],
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
          profile: this.descriptor.id,
          cwd: project.root,
          agentDir: this.#agentDir,
          ...(project.veil === undefined
            ? {}
            : { veil: { api: project.veil.veil, project: project.veil.project } }),
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
          payload: { profile: this.descriptor.id, runtime: pi.descriptor },
        });
      } catch (error) {
        pi.dispose();
        throw error;
      }

      const state: RuntimeState = {
        projectId: input.projectId,
        sessionId: input.sessionId,
        profile: this.descriptor.id,
        runtime: pi.descriptor,
        store,
        pi,
        project,
        activeTask: undefined,
        knownTasks: new Set(),
      };
      this.#sessions.set(key, state);
      return publicSession(state);
    } finally {
      this.#starting.delete(key);
    }
  }

  async recover(input: SessionRecoveryPlan): Promise<RuntimeSession | undefined> {
    if (input.profile !== this.descriptor.id) {
      throw new RuntimeAdapterError(
        "PROFILE_UNAVAILABLE",
        "The durable session does not belong to this Pi adapter",
      );
    }
    if (input.disposition === "closed" || input.disposition === "failed") return undefined;

    const key = runtimeKey(input.projectId, input.sessionId);
    if (this.#sessions.has(key) || this.#starting.has(key)) {
      throw new RuntimeAdapterError("SESSION_CONFLICT", "The session is already active");
    }
    this.#starting.add(key);

    try {
      const store = await this.#eventStores.get(input.projectId, input.sessionId);
      await store.append({
        type: "session.status_changed",
        payload: { status: "recovering", reason: "daemon_restart" },
      });
      for (const taskId of input.interruptedTaskIds) {
        await store.append({
          type: "task.interrupted",
          payload: {
            taskId,
            code: "DAEMON_RESTART",
            remedy: "Retry the request; the previous task has no successful terminal record.",
          },
        });
      }

      if (input.disposition === "incomplete" || input.runtime === undefined) {
        await store.append({
          type: "session.status_changed",
          payload: {
            status: "failed",
            code: "SESSION_START_INTERRUPTED",
            remedy: "Create a new session; the previous runtime did not become ready.",
          },
        });
        return undefined;
      }

      let project: RuntimeProjectContext;
      try {
        project = await this.#project(input.projectId);
      } catch (error) {
        await store.append({
          type: "session.status_changed",
          payload: {
            status: "failed",
            code: "PROJECT_NOT_READY",
            remedy: "Restore the registered project and its Veil configuration before retrying.",
          },
        });
        throw error;
      }

      let pi: HostedPiSession;
      try {
        pi = await this.#sessionFactory.create({
          projectId: input.projectId,
          sessionId: input.sessionId,
          profile: this.descriptor.id,
          cwd: project.root,
          agentDir: this.#agentDir,
          ...(project.veil === undefined
            ? {}
            : { veil: { api: project.veil.veil, project: project.veil.project } }),
          recovery: {
            ...(input.publicContext === undefined ? {} : { publicContext: input.publicContext }),
            interruptedTaskIds: input.interruptedTaskIds,
          },
        });
        if (
          !isLoomPiRuntimeDescriptor(pi.descriptor) ||
          !sameRuntimeDescriptor(input.runtime, pi.descriptor)
        ) {
          pi.dispose();
          throw new Error("The recovered Pi runtime descriptor does not match the durable record");
        }
      } catch (error) {
        await store.append({
          type: "session.status_changed",
          payload: {
            status: "failed",
            code: "PI_RECOVERY_FAILED",
            remedy:
              "Inspect the daemon's private diagnostics, repair the local runtime, and retry recovery.",
          },
        });
        throw new RuntimeAdapterError(
          "RUNTIME_UNAVAILABLE",
          "The durable Pi runtime could not be recovered",
          { cause: error },
        );
      }

      try {
        await store.append({
          type: "session.status_changed",
          payload: { status: "ready", recovery: pi.recovery },
        });
      } catch (error) {
        pi.dispose();
        throw error;
      }

      const state: RuntimeState = {
        projectId: input.projectId,
        sessionId: input.sessionId,
        profile: this.descriptor.id,
        runtime: pi.descriptor,
        store,
        pi,
        project,
        activeTask: undefined,
        knownTasks: new Set(input.knownTaskIds),
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
      abort: () => state.pi.session.abort(),
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
          ...(input.selection === undefined ? {} : { selectionId: input.selection.selectionId }),
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
          label: `Run ${this.descriptor.label} request`,
        },
      });
    } catch (error) {
      state.activeTask = undefined;
      state.knownTasks.delete(task.id);
      throw error;
    }

    task.runPromise = this.#runTask(state, task, input.content, input.selection);
    void task.runPromise.catch(() => undefined);
    return accepted(input);
  }

  async promote(input: StartPromotionInput): Promise<void> {
    if (this.descriptor.id !== "veil") {
      throw new RuntimeAdapterError(
        "PROMOTION_NOT_AVAILABLE",
        "Only a Veil session can own a verification attempt",
      );
    }
    const state = this.#requireSession(input.projectId, input.sessionId);
    const veil = state.project.veil;
    if (veil === undefined) {
      throw new RuntimeAdapterError("PROJECT_NOT_READY", "The Veil project context is unavailable");
    }
    if (state.activeTask !== undefined) {
      throw new RuntimeAdapterError("SESSION_BUSY", "The session already has an active task");
    }
    if (input.promotion.sourceSessionId === input.sessionId) {
      throw new RuntimeAdapterError(
        "PROMOTION_NOT_AVAILABLE",
        "A verification attempt must use a new session",
      );
    }

    const controller = new AbortController();
    let hypothesis: VeilHypothesisEntry;
    try {
      hypothesis = veil.veil.api.createHypothesisEntry({
        statement: input.promotion.hypothesisStatement,
        ideaAvailableAt: new Date().toISOString(),
        captureMode: "explicit",
      });
      assertVeilHypothesis(hypothesis, input.promotion.hypothesisStatement);
      const manager = state.pi.session.sessionManager;
      const hypothesisEntryId = manager.appendCustomEntry(
        veil.veil.api.VEIL_HYPOTHESIS_ENTRY,
        hypothesis,
      );
      const hypothesisTimestamp = branchEntryTimestamp(manager.getBranch(), hypothesisEntryId);
      await waitPastTimestamp(hypothesisTimestamp, controller.signal);
    } catch (error) {
      throw new RuntimeAdapterError(
        "PROMOTION_NOT_AVAILABLE",
        "Veil rejected or could not record the portable hypothesis",
        { cause: error },
      );
    }

    const task: ActiveTask = {
      id: input.taskId,
      commandId: input.commandId,
      messageId: input.attemptId,
      cancelRequested: false,
      acceptingCancel: true,
      assistantTurn: 0,
      currentAssistant: undefined,
      sawAborted: false,
      sawError: false,
      projectionError: undefined,
      projectionQueue: Promise.resolve(),
      runPromise: Promise.resolve(),
      abort: async () => controller.abort(),
    };
    const started = {
      format: "loom.veil-verification-started.v0",
      attemptId: input.attemptId,
      commandId: input.commandId,
      taskId: input.taskId,
      relation: "derived-from-exploration",
      source: {
        sessionId: input.promotion.sourceSessionId,
        viewId: input.promotion.sourceViewId,
      },
      artifact: input.promotion.artifact,
      hypothesis: {
        ref: hypothesis.hypothesisRef,
        statement: hypothesis.statement,
      },
    } as const;
    if (!isLoomVeilVerificationStartedPayload(started)) {
      throw new RuntimeAdapterError(
        "PROMOTION_NOT_AVAILABLE",
        "The verification attempt metadata is invalid",
      );
    }

    state.activeTask = task;
    state.knownTasks.add(task.id);
    try {
      await state.store.append({
        type: "session.status_changed",
        payload: { status: "busy" },
      });
      await state.store.append({
        type: "task.started",
        payload: {
          taskId: task.id,
          commandId: task.commandId,
          kind: "veil-verification",
          label: "Run independent Veil verification",
        },
      });
      await state.store.append({ type: "veil.verification_started", payload: started });
    } catch (error) {
      state.activeTask = undefined;
      state.knownTasks.delete(task.id);
      controller.abort();
      throw error;
    }

    task.runPromise = this.#runPromotion(state, task, input, hypothesis, controller.signal);
    void task.runPromise.catch(() => undefined);
  }

  async reproduce(input: StartReproductionInput): Promise<void> {
    if (this.descriptor.id !== "veil") {
      throw new RuntimeAdapterError(
        "EXPERIMENT_UNAVAILABLE",
        "Only a Veil session can reproduce an Experiment",
      );
    }
    const state = this.#requireSession(input.projectId, input.sessionId);
    if (state.project.veil === undefined) {
      throw new RuntimeAdapterError("PROJECT_NOT_READY", "The Veil project context is unavailable");
    }
    if (state.activeTask !== undefined) {
      throw new RuntimeAdapterError("SESSION_BUSY", "The session already has an active task");
    }
    if (
      input.experiment.projectId !== input.projectId ||
      input.experiment.sessionId !== input.sessionId
    ) {
      throw new RuntimeAdapterError(
        "EXPERIMENT_UNAVAILABLE",
        "The Experiment does not belong to this Veil session",
      );
    }

    const controller = new AbortController();
    const task: ActiveTask = {
      id: input.taskId,
      commandId: input.commandId,
      messageId: input.experiment.experimentId,
      cancelRequested: false,
      acceptingCancel: true,
      assistantTurn: 0,
      currentAssistant: undefined,
      sawAborted: false,
      sawError: false,
      projectionError: undefined,
      projectionQueue: Promise.resolve(),
      runPromise: Promise.resolve(),
      abort: async () => controller.abort(),
    };
    state.activeTask = task;
    state.knownTasks.add(task.id);
    try {
      await state.store.append({
        type: "session.status_changed",
        payload: { status: "busy" },
      });
      await state.store.append({
        type: "task.started",
        payload: {
          taskId: task.id,
          commandId: task.commandId,
          kind: "veil-reproduction",
          label: "Reproduce Veil Experiment",
        },
      });
    } catch (error) {
      state.activeTask = undefined;
      state.knownTasks.delete(task.id);
      controller.abort();
      throw error;
    }

    task.runPromise = this.#runReproduction(state, task, input, controller.signal);
    void task.runPromise.catch(() => undefined);
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
    void task.abort().catch(() => undefined);
    return accepted(input);
  }

  async close(input: CloseSessionInput): Promise<void> {
    const key = runtimeKey(input.projectId, input.sessionId);
    const state = this.#sessions.get(key);
    if (state === undefined) return;
    if (state.activeTask !== undefined) {
      state.activeTask.cancelRequested = true;
      state.activeTask.acceptingCancel = false;
      await state.activeTask.abort();
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

  async #project(projectId: string): Promise<RuntimeProjectContext> {
    try {
      if (this.descriptor.id === "veil") {
        const veil = await this.#projects.requireVeilProject(projectId);
        return { root: veil.root, veil };
      }
      return { root: await this.#projects.root(projectId) };
    } catch (error) {
      throw new RuntimeAdapterError(
        "PROJECT_NOT_READY",
        "The project is not ready for this runtime profile",
        { cause: error },
      );
    }
  }

  #requireSession(projectId: string, sessionId: string): RuntimeState {
    const state = this.#sessions.get(runtimeKey(projectId, sessionId));
    if (state === undefined) {
      throw new RuntimeAdapterError("SESSION_NOT_FOUND", "The runtime session was not found");
    }
    return state;
  }

  async #runTask(
    state: RuntimeState,
    task: ActiveTask,
    content: string,
    selection: LoomSelection | undefined,
  ): Promise<void> {
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
      state.pi.preparePrompt({
        taskId: task.id,
        ...(selection === undefined ? {} : { selection }),
      });
      await state.pi.session.prompt(buildPiPrompt(content, selection));
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

  async #runPromotion(
    state: RuntimeState,
    task: ActiveTask,
    input: StartPromotionInput,
    hypothesis: VeilHypothesisEntry,
    signal: AbortSignal,
  ): Promise<void> {
    const veil = state.project.veil;
    if (veil === undefined) throw new Error("The Veil project context disappeared");
    const api = veil.veil.api;
    const manager = state.pi.session.sessionManager;
    let failure: unknown;
    let experiment:
      | {
          readonly result: CompleteVeilBacktestResult;
          readonly archive: VeilExperimentArchive;
        }
      | undefined;

    try {
      throwIfPromotionAborted(signal);
      const development = await api.executeVeilDataTool(
        {
          dataset: "daily-factor-prices",
          mode: "panel",
          as_of: DAILY_FACTOR_DECISION_SCHEDULE.at(-1) ?? "2024-02-04T00:00:00.000Z",
          columns: ["ticker", "close", "volume"],
          output: "summary",
        },
        {
          project: veil.project,
          appendEntry: (customType, data) => {
            manager.appendCustomEntry(customType, data);
          },
        },
      );
      assertDevelopmentRead(development);
      throwIfPromotionAborted(signal);
      await appendVeilStage(state.store, input, "development-data", "completed");
      const requestReference = await writeDailyFactorPromotionRequest({
        projectRoot: veil.root,
        attemptId: input.attemptId,
        hypothesisRef: hypothesis.hypothesisRef,
        developmentReadSetId: development.evidence.readSetId,
        promotion: input.promotion,
      });
      throwIfPromotionAborted(signal);
      await appendVeilStage(state.store, input, "independent-verification", "running");
      const result = await api.executeVeilBacktestTool(
        { request: requestReference },
        {
          project: veil.project,
          getBranch: () => manager.getBranch(),
          appendEntry: (customType, data) => {
            manager.appendCustomEntry(customType, data);
          },
          signal,
        },
      );
      throwIfPromotionAborted(signal);
      if (!result.ok) throw new Error("Veil did not issue a promotion result");
      assertCompleteVeilResult(result);
      const archive = await api.loadProjectExperiment(veil.root, result.experimentId);
      assertMatchingVeilArchive(result, archive, hypothesis.hypothesisRef);
      throwIfPromotionAborted(signal);
      experiment = { result, archive };
    } catch (error) {
      failure = error;
    }

    task.acceptingCancel = false;
    try {
      if (task.cancelRequested || signal.aborted) {
        await state.store.append({
          type: "task.cancelled",
          payload: { taskId: task.id },
        });
      } else if (failure !== undefined || experiment === undefined) {
        await state.store.append({
          type: "task.failed",
          payload: {
            taskId: task.id,
            code: "VEIL_VERIFICATION_FAILED",
            remedy:
              "Inspect the trusted daemon and Veil diagnostics, correct the project or artifact, and create a new attempt.",
          },
        });
      } else {
        const payload = experimentPayload(input, experiment.result, experiment.archive);
        if (!isLoomVeilExperimentRecordedPayload(payload)) {
          throw new Error("Veil returned an invalid Experiment projection");
        }
        await appendVeilStage(state.store, input, "independent-verification", "completed");
        await state.store.append({ type: "veil.experiment_recorded", payload });
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

  async #runReproduction(
    state: RuntimeState,
    task: ActiveTask,
    input: StartReproductionInput,
    signal: AbortSignal,
  ): Promise<void> {
    const veil = state.project.veil;
    if (veil === undefined) throw new Error("The Veil project context disappeared");
    let failure: unknown;
    let reproduction: VeilExperimentReproduction | undefined;
    try {
      throwIfPromotionAborted(signal);
      reproduction = await veil.veil.api.reproduceProjectExperiment({
        project: veil.project,
        experimentId: input.experiment.experimentId,
        signal,
      });
      throwIfPromotionAborted(signal);
      assertVeilReproduction(reproduction, input.experiment);
    } catch (error) {
      failure = error;
    }

    task.acceptingCancel = false;
    try {
      if (task.cancelRequested || signal.aborted) {
        await state.store.append({
          type: "task.cancelled",
          payload: { taskId: task.id },
        });
      } else if (failure !== undefined || reproduction === undefined) {
        await state.store.append({
          type: "task.failed",
          payload: {
            taskId: task.id,
            code: "VEIL_REPRODUCTION_FAILED",
            remedy:
              "Inspect the trusted daemon and Veil diagnostics, restore the exact snapshots, and retry reproduction.",
          },
        });
      } else {
        const payload = {
          format: "loom.veil-reproduction-completed.v0",
          attemptId: input.experiment.attemptId,
          taskId: task.id,
          experimentId: reproduction.experimentId,
          reproducedExperimentId: reproduction.reproducedExperimentId,
          pricingHash: reproduction.pricingHash,
          gateEvaluationHash: reproduction.gateEvaluationHash,
          metricsHash: reproduction.metricsHash,
          status: reproduction.status,
          reproductionHash: reproduction.reproductionHash,
        } as const;
        if (!isLoomVeilReproductionCompletedPayload(payload)) {
          throw new Error("Veil returned an invalid reproduction projection");
        }
        await state.store.append({ type: "veil.reproduction_completed", payload });
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

interface RuntimeProjectContext {
  root: string;
  veil?: VeilProjectContext;
}

export type RawPiRuntimeAdapterOptions = Omit<PiRuntimeAdapterOptions, "descriptor">;

export class RawPiRuntimeAdapter extends PiRuntimeAdapter {
  constructor(options: RawPiRuntimeAdapterOptions) {
    super({ ...options, descriptor: RAW_PI_PROFILE });
  }
}

export class VeilPiRuntimeAdapter extends PiRuntimeAdapter {
  constructor(options: RawPiRuntimeAdapterOptions) {
    super({ ...options, descriptor: VEIL_PROFILE });
  }
}

/** Adds bounded daemon-owned selection context without exposing the underlying series. */
export function buildPiPrompt(content: string, selection: LoomSelection | undefined): string {
  if (selection === undefined) return content;
  const context = {
    format: "loom.selection-context.v0",
    selectionId: selection.selectionId,
    view: {
      format: "loom.backtest-view.v0",
      viewId: selection.viewId,
    },
    range: { from: selection.from, until: selection.until },
    visibleSummary: selection.visibleSummary,
  };
  return [
    "Use the following daemon-derived Loom selection context. It is a bounded summary, not raw research data.",
    "<loom_selection_context>",
    JSON.stringify(context),
    "</loom_selection_context>",
    "",
    content,
  ].join("\n");
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

function profileLimitation(profile: LoomSessionProfile): string {
  return profile === "raw-pi"
    ? "This session has not been independently verified by Veil."
    : "Veil capability is loaded, but no result is verified until Veil issues independent evidence.";
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

const VEIL_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const VEIL_PORTABLE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;

function assertVeilHypothesis(input: VeilHypothesisEntry, statement: string): void {
  if (
    input === null ||
    typeof input !== "object" ||
    input.format !== "veil.hypothesis.v0" ||
    !VEIL_PORTABLE_REFERENCE.test(input.hypothesisRef) ||
    input.statement !== statement ||
    input.captureMode !== "explicit" ||
    !isCanonicalTime(input.ideaAvailableAt)
  ) {
    throw new Error("Veil returned an invalid hypothesis entry");
  }
}

function assertDevelopmentRead(input: VeilDataToolResult): asserts input is VeilDataToolResult {
  const expectedAsOf = DAILY_FACTOR_DECISION_SCHEDULE.at(-1);
  if (
    input === null ||
    typeof input !== "object" ||
    input.format !== "veil.agent-tool-result.v0" ||
    input.tool !== "veil-data" ||
    input.ok !== true ||
    input.dataset !== "daily-factor-prices" ||
    input.adapterVersion !== "2026-08-18" ||
    input.view.mode !== "panel" ||
    input.view.grade !== "exploration-grade" ||
    input.view.asOf !== expectedAsOf ||
    !Number.isSafeInteger(input.view.rowCount) ||
    input.view.rowCount < 1 ||
    input.exportReference !== null ||
    !VEIL_SHA256.test(input.evidence.readSetId) ||
    !VEIL_SHA256.test(input.evidence.resultHash) ||
    !VEIL_SHA256.test(input.evidence.arrowHash)
  ) {
    throw new Error("Veil returned an invalid development data record");
  }
}

function assertCompleteVeilResult(
  input: VeilBacktestSuccess,
): asserts input is CompleteVeilBacktestResult {
  const expectedClaimStatus =
    input.verdict === "accepted"
      ? "verified"
      : input.verdict === "degraded"
        ? "degraded"
        : input.verdict === "rejected"
          ? "rejected"
          : undefined;
  if (
    input.format !== "veil.agent-tool-result.v0" ||
    input.tool !== "veil-backtest" ||
    input.ok !== true ||
    input.status !== "complete" ||
    input.structuralStatus !== "contract-verified" ||
    input.registrationStatus !== "preregistered" ||
    !VEIL_PORTABLE_REFERENCE.test(input.researchRunId) ||
    typeof input.experimentId !== "string" ||
    !VEIL_SHA256.test(input.experimentId) ||
    expectedClaimStatus === undefined ||
    input.claimStatus !== expectedClaimStatus ||
    input.requiredEvidence.length !== 0 ||
    !/^\.veil\/runs\/[a-f0-9]{64}\.json$/u.test(input.evidenceReference) ||
    input.researchLogReference !== ".veil/research-log.md" ||
    input.experimentArchiveReference !==
      `.veil/experiments/${input.experimentId.slice("sha256:".length)}.json` ||
    ![input.artifactHash, input.planHash, input.contractHash, input.candidateHash].every((hash) =>
      VEIL_SHA256.test(hash),
    ) ||
    !Number.isSafeInteger(input.executionCount) ||
    input.executionCount < 1
  ) {
    throw new Error("Veil returned an incomplete Experiment result");
  }
}

function assertMatchingVeilArchive(
  result: CompleteVeilBacktestResult,
  archive: VeilExperimentArchive,
  hypothesisRef: string,
): void {
  const experiment = archive?.execution?.experiment;
  if (
    archive?.format !== "veil.experiment-archive.v0" ||
    !VEIL_SHA256.test(archive.archiveHash) ||
    archive.execution.format !== "veil.experiment-execution.v0" ||
    experiment === undefined ||
    experiment.status !== "complete" ||
    experiment.experimentId !== result.experimentId ||
    experiment.candidateHash !== result.candidateHash ||
    experiment.artifactHash !== result.artifactHash ||
    experiment.planHash !== result.planHash ||
    experiment.contractHash !== result.contractHash ||
    experiment.hypothesis.hypothesisRef !== hypothesisRef ||
    experiment.hypothesis.registrationStatus !== result.registrationStatus ||
    experiment.verdict !== result.verdict ||
    experiment.claimStatus !== result.claimStatus
  ) {
    throw new Error("The independently verified Experiment archive does not match the result");
  }
}

function assertVeilReproduction(
  input: VeilExperimentReproduction,
  expected: OwnedExperiment,
): void {
  if (
    input === null ||
    typeof input !== "object" ||
    input.format !== "veil.experiment-reproduction.v0" ||
    input.status !== "matched" ||
    input.experimentId !== expected.experimentId ||
    input.reproducedExperimentId !== expected.experimentId ||
    input.pricingHash !== expected.pricingHash ||
    input.gateEvaluationHash !== expected.gateEvaluationHash ||
    input.metricsHash !== expected.metricsHash ||
    input.reproductionHash !== expected.reproductionHash
  ) {
    throw new Error("Veil returned an invalid Experiment reproduction");
  }
}

function experimentPayload(
  input: StartPromotionInput,
  result: CompleteVeilBacktestResult,
  archive: VeilExperimentArchive,
) {
  const limitations = [
    "This assurance applies only to the new Veil attempt, not the source Raw Pi metrics.",
    result.verdict === "accepted"
      ? "Use the exact Experiment identity when citing or reproducing this result."
      : result.verdict === "degraded"
        ? "One or more Veil gates were degraded or unavailable; inspect the Experiment evidence."
        : "Veil rejected the Experiment; it does not support a positive effect claim.",
  ];
  return {
    format: "loom.veil-experiment-recorded.v0",
    attemptId: input.attemptId,
    taskId: input.taskId,
    experimentId: result.experimentId,
    archiveHash: archive.archiveHash,
    researchRunId: result.researchRunId,
    verdict: result.verdict,
    claimStatus: result.claimStatus,
    registrationStatus: result.registrationStatus,
    artifactHash: result.artifactHash,
    planHash: result.planHash,
    contractHash: result.contractHash,
    candidateHash: result.candidateHash,
    executionCount: result.executionCount,
    assurance: {
      format: "loom.assurance.v0",
      state: result.verdict,
      issuer: "veil",
      evidenceRefs: [result.experimentId, archive.archiveHash],
      limitations,
    },
  } as const;
}

async function appendVeilStage(
  store: SessionEventStore,
  input: StartPromotionInput,
  stage: "development-data" | "independent-verification",
  status: "running" | "completed",
): Promise<void> {
  const payload = {
    format: "loom.veil-stage-changed.v0",
    attemptId: input.attemptId,
    taskId: input.taskId,
    stage,
    status,
  } as const;
  if (!isLoomVeilStageChangedPayload(payload)) {
    throw new Error("The Veil stage projection is invalid");
  }
  await store.append({ type: "veil.stage_changed", payload });
}

function branchEntryTimestamp(entries: readonly unknown[], entryId: string): string {
  const matches = entries.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      "id" in entry &&
      entry.id === entryId &&
      "timestamp" in entry &&
      typeof entry.timestamp === "string" &&
      isCanonicalTime(entry.timestamp),
  ) as Array<{ readonly timestamp: string }>;
  if (matches.length !== 1) throw new Error("The Veil hypothesis ledger entry is unavailable");
  return matches[0]?.timestamp ?? "";
}

async function waitPastTimestamp(timestamp: string, signal: AbortSignal): Promise<void> {
  const milliseconds = Date.parse(timestamp);
  const delay = milliseconds - Date.now() + 1;
  if (!Number.isFinite(milliseconds) || delay > 5_000) {
    throw new Error("The Veil ledger clock is invalid");
  }
  if (delay <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delay);
    signal.addEventListener("abort", aborted, { once: true });
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(new Error("The Veil verification was cancelled"));
    }
  });
}

function throwIfPromotionAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("The Veil verification was cancelled");
}

function isCanonicalTime(input: string): boolean {
  const milliseconds = Date.parse(input);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === input;
}
