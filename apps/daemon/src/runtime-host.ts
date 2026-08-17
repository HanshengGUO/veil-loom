import { randomUUID } from "node:crypto";
import {
  isLoomPortableId,
  type LoomAcceptedCommandResponse,
  type LoomProfileDescriptor,
  type LoomProjectReadinessResponse,
  type LoomSelection,
  type LoomSessionProfile,
} from "@veilquant/loom-protocol";
import type { SessionEventStoreRegistry } from "./event-store.js";
import {
  DeterministicPiSessionFactory,
  type DeterministicPiSessionFactoryOptions,
} from "./pi/deterministic-session.js";
import { LoomProjectRegistry } from "./project-readiness.js";
import { DailyFactorReferenceAdapter } from "./reference-backtest/reference-adapter.js";
import { ResearchArtifactStore } from "./research-artifacts.js";
import {
  type LoomRuntimeAdapter,
  RawPiRuntimeAdapter,
  RuntimeAdapterError,
  VeilPiRuntimeAdapter,
} from "./runtime-adapter.js";
import { SelectionService } from "./selection-service.js";
import { projectSessionRecovery } from "./session-recovery.js";

type RuntimeIdKind = "session" | "command" | "task" | "message";

export type RuntimeIdSource = (kind: RuntimeIdKind) => string;

export interface RuntimeHostOptions {
  adapters: readonly LoomRuntimeAdapter[];
  eventStores: SessionEventStoreRegistry;
  projects: LoomProjectRegistry;
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

export interface RuntimeReconciliationReport {
  discovered: number;
  recovered: number;
  skipped: number;
  failed: number;
  interruptedTasks: number;
}

/** Routes profile-neutral commands to one adapter while keeping generated IDs out of adapters. */
export class LoomRuntimeHost {
  readonly #adapters: Map<LoomSessionProfile, LoomRuntimeAdapter>;
  readonly #sessions = new Map<string, LoomRuntimeAdapter>();
  readonly #eventStores: SessionEventStoreRegistry;
  readonly #projects: LoomProjectRegistry;
  readonly #idSource: RuntimeIdSource;
  readonly #selections: SelectionService | undefined;

  constructor(options: RuntimeHostOptions) {
    this.#adapters = new Map(
      options.adapters.map((adapter) => [adapter.descriptor.id, adapter] as const),
    );
    if (this.#adapters.size !== options.adapters.length) {
      throw new Error("Loom runtime profile identifiers must be unique");
    }
    this.#eventStores = options.eventStores;
    this.#projects = options.projects;
    this.#idSource = options.idSource ?? defaultIdSource;
    this.#selections = options.selections;
  }

  profileDescriptors(): readonly LoomProfileDescriptor[] {
    return [...this.#adapters.values()].map((adapter) => adapter.descriptor);
  }

  projectReadiness(projectId: string): Promise<LoomProjectReadinessResponse> {
    assertRuntimeId(projectId);
    return this.#projects.readiness(projectId);
  }

  async reconcileDurableSessions(): Promise<RuntimeReconciliationReport> {
    const identities = await this.#eventStores.discover();
    const report: RuntimeReconciliationReport = {
      discovered: identities.length,
      recovered: 0,
      skipped: 0,
      failed: 0,
      interruptedTasks: 0,
    };

    for (const identity of identities) {
      const key = runtimeKey(identity.projectId, identity.sessionId);
      if (this.#sessions.has(key)) {
        report.skipped += 1;
        continue;
      }
      try {
        const store = await this.#eventStores.get(identity.projectId, identity.sessionId);
        const plan = projectSessionRecovery(
          identity.projectId,
          identity.sessionId,
          await store.replay(),
        );
        const adapter = this.#adapters.get(plan.profile);
        if (
          adapter === undefined ||
          plan.disposition === "closed" ||
          plan.disposition === "failed"
        ) {
          report.skipped += 1;
          continue;
        }
        report.interruptedTasks += plan.interruptedTaskIds.length;
        const recovered = await adapter.recover(plan);
        if (recovered === undefined) {
          report.failed += 1;
          continue;
        }
        this.#sessions.set(key, adapter);
        report.recovered += 1;
      } catch {
        // A corrupt or unavailable session is isolated; other durable sessions can still recover.
        report.failed += 1;
      }
    }
    return report;
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
  projects?: LoomProjectRegistry;
}

export function createDefaultRuntimeHost(options: DefaultRuntimeHostOptions): LoomRuntimeHost {
  const artifacts =
    options.artifacts ?? new ResearchArtifactStore({ stateRoot: options.eventStores.stateRoot });
  const referenceBacktests = new DailyFactorReferenceAdapter(artifacts);
  const selections =
    options.selections ?? new SelectionService({ artifacts, eventStores: options.eventStores });
  const projects = options.projects ?? new LoomProjectRegistry({ fallbackRoot: options.cwd });
  const sessionFactory = new DeterministicPiSessionFactory({ referenceBacktests }, options.fixture);
  const rawPi = new RawPiRuntimeAdapter({
    eventStores: options.eventStores,
    sessionFactory,
    cwd: options.cwd,
    agentDir: options.agentDir,
    projects,
  });
  const veilPi = new VeilPiRuntimeAdapter({
    eventStores: options.eventStores,
    sessionFactory,
    cwd: options.cwd,
    agentDir: options.agentDir,
    projects,
  });
  return new LoomRuntimeHost({
    adapters: [rawPi, veilPi],
    eventStores: options.eventStores,
    projects,
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
