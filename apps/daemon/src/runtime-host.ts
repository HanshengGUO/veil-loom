import { randomUUID } from "node:crypto";
import {
  isLoomPortableId,
  type LoomAcceptedCommandResponse,
  type LoomSelection,
  type LoomSessionProfile,
} from "@veilquant/loom-protocol";
import type { SessionEventStoreRegistry } from "./event-store.js";
import {
  DeterministicPiSessionFactory,
  type DeterministicPiSessionFactoryOptions,
} from "./pi/deterministic-session.js";
import { DailyFactorReferenceAdapter } from "./reference-backtest/reference-adapter.js";
import { ResearchArtifactStore } from "./research-artifacts.js";
import {
  type LoomRuntimeAdapter,
  RawPiRuntimeAdapter,
  RuntimeAdapterError,
} from "./runtime-adapter.js";
import { SelectionService } from "./selection-service.js";

type RuntimeIdKind = "session" | "command" | "task" | "message";

export type RuntimeIdSource = (kind: RuntimeIdKind) => string;

export interface RuntimeHostOptions {
  adapters: readonly LoomRuntimeAdapter[];
  selections?: SelectionService;
  idSource?: RuntimeIdSource;
}

export interface CreateRuntimeSessionInput {
  projectId: string;
  profile: LoomSessionProfile;
  title?: string;
}

export interface SendRuntimeMessageInput {
  projectId: string;
  sessionId: string;
  content: string;
  selectionId?: string;
}

export interface CancelRuntimeTaskInput {
  projectId: string;
  sessionId: string;
  taskId: string;
}

export interface CreateRuntimeIdentity {
  sessionId: string;
  commandId: string;
}

export interface MessageRuntimeIdentity {
  commandId: string;
  taskId: string;
  messageId: string;
}

/** Routes profile-neutral commands to one adapter while keeping generated IDs out of adapters. */
export class LoomRuntimeHost {
  readonly #adapters: Map<LoomSessionProfile, LoomRuntimeAdapter>;
  readonly #sessions = new Map<string, LoomRuntimeAdapter>();
  readonly #idSource: RuntimeIdSource;
  readonly #selections: SelectionService | undefined;

  constructor(options: RuntimeHostOptions) {
    this.#adapters = new Map(
      options.adapters.map((adapter) => [adapter.descriptor.id, adapter] as const),
    );
    this.#idSource = options.idSource ?? defaultIdSource;
    this.#selections = options.selections;
  }

  async createSession(
    input: CreateRuntimeSessionInput,
    identity: CreateRuntimeIdentity = {
      sessionId: "",
      commandId: "",
    },
  ): Promise<LoomAcceptedCommandResponse> {
    assertRuntimeId(input.projectId);
    const adapter = this.#adapters.get(input.profile);
    if (adapter === undefined) {
      throw new RuntimeAdapterError(
        "PROFILE_UNAVAILABLE",
        `The ${input.profile} profile is not available in this daemon`,
      );
    }
    const sessionId = identity.sessionId || this.#nextId("session");
    const commandId = identity.commandId || this.#nextId("command");
    assertRuntimeId(sessionId);
    assertRuntimeId(commandId);
    const key = runtimeKey(input.projectId, sessionId);
    if (this.#sessions.has(key)) {
      throw new RuntimeAdapterError("SESSION_CONFLICT", "The session is already registered");
    }

    await adapter.start({
      projectId: input.projectId,
      sessionId,
      commandId,
      ...(input.title === undefined ? {} : { title: input.title }),
    });
    this.#sessions.set(key, adapter);
    return {
      format: "loom.command.accepted.v0",
      commandId,
      projectId: input.projectId,
      sessionId,
    };
  }

  async sendMessage(
    input: SendRuntimeMessageInput,
    identity: MessageRuntimeIdentity = {
      commandId: "",
      taskId: "",
      messageId: "",
    },
  ): Promise<LoomAcceptedCommandResponse> {
    const adapter = this.#requireSession(input.projectId, input.sessionId);
    const commandId = identity.commandId || this.#nextId("command");
    const taskId = identity.taskId || this.#nextId("task");
    const messageId = identity.messageId || this.#nextId("message");
    for (const id of [input.projectId, input.sessionId, commandId, taskId, messageId]) {
      assertRuntimeId(id);
    }
    let selection: LoomSelection | undefined;
    if (input.selectionId !== undefined) {
      if (this.#selections === undefined) {
        throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", "Selection context is unavailable");
      }
      selection = await this.#selections.resolve(
        input.projectId,
        input.sessionId,
        input.selectionId,
      );
    }
    const { selectionId: _selectionId, ...message } = input;
    return adapter.send({
      ...message,
      commandId,
      taskId,
      messageId,
      ...(selection === undefined ? {} : { selection }),
    });
  }

  async cancelTask(
    input: CancelRuntimeTaskInput,
    commandId = "",
  ): Promise<LoomAcceptedCommandResponse> {
    const adapter = this.#requireSession(input.projectId, input.sessionId);
    const resolvedCommandId = commandId || this.#nextId("command");
    for (const id of [input.projectId, input.sessionId, input.taskId, resolvedCommandId]) {
      assertRuntimeId(id);
    }
    return adapter.cancel({ ...input, commandId: resolvedCommandId });
  }

  async closeSession(projectId: string, sessionId: string): Promise<void> {
    const key = runtimeKey(projectId, sessionId);
    const adapter = this.#sessions.get(key);
    if (adapter === undefined) return;
    await adapter.close({ projectId, sessionId });
    this.#sessions.delete(key);
  }

  async waitForIdle(projectId: string, sessionId: string): Promise<void> {
    const adapter = this.#requireSession(projectId, sessionId);
    await adapter.waitForIdle?.(projectId, sessionId);
  }

  #requireSession(projectId: string, sessionId: string): LoomRuntimeAdapter {
    const adapter = this.#sessions.get(runtimeKey(projectId, sessionId));
    if (adapter === undefined) {
      throw new RuntimeAdapterError("SESSION_NOT_FOUND", "The runtime session was not found");
    }
    return adapter;
  }

  #nextId(kind: RuntimeIdKind): string {
    const id = this.#idSource(kind);
    assertRuntimeId(id);
    return id;
  }
}

export interface DefaultRuntimeHostOptions {
  eventStores: SessionEventStoreRegistry;
  artifacts?: ResearchArtifactStore;
  cwd: string;
  agentDir: string;
  fixture?: DeterministicPiSessionFactoryOptions;
  idSource?: RuntimeIdSource;
  selections?: SelectionService;
}

export function createDefaultRuntimeHost(options: DefaultRuntimeHostOptions): LoomRuntimeHost {
  const artifacts =
    options.artifacts ?? new ResearchArtifactStore({ stateRoot: options.eventStores.stateRoot });
  const referenceBacktests = new DailyFactorReferenceAdapter(artifacts);
  const selections =
    options.selections ?? new SelectionService({ artifacts, eventStores: options.eventStores });
  const rawPi = new RawPiRuntimeAdapter({
    eventStores: options.eventStores,
    sessionFactory: new DeterministicPiSessionFactory({ referenceBacktests }, options.fixture),
    cwd: options.cwd,
    agentDir: options.agentDir,
  });
  return new LoomRuntimeHost({
    adapters: [rawPi],
    selections,
    ...(options.idSource === undefined ? {} : { idSource: options.idSource }),
  });
}

function defaultIdSource(kind: RuntimeIdKind): string {
  return `${kind}_${randomUUID()}`;
}

function assertRuntimeId(input: string): void {
  if (!isLoomPortableId(input)) {
    throw new RuntimeAdapterError("RUNTIME_UNAVAILABLE", "The runtime produced an invalid ID");
  }
}

function runtimeKey(projectId: string, sessionId: string): string {
  return `${projectId}\0${sessionId}`;
}
