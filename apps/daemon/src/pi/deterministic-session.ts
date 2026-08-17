import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type InlineExtension,
  ModelRuntime,
  VERSION as PI_VERSION,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  LoomPiRuntimeDescriptor,
  LoomSelection,
  LoomSessionProfile,
} from "@veilquant/loom-protocol";
import type { DailyFactorReferenceAdapter } from "../reference-backtest/reference-adapter.js";
import type { LoadedVeilApi, VeilProject } from "../veil-api.js";
import {
  createLoomReferenceBacktestExtension,
  LOOM_REFERENCE_BACKTEST_TOOL_NAME,
} from "./loom-extension.js";

export const LOOM_FIXTURE_PROVIDER = "loom-offline-fixture";
export const LOOM_FIXTURE_MODEL = "loom-fixture-v0";
export const LOOM_FIXTURE_PREAMBLE =
  "I’ll run the committed daily-factor reference backtest through Loom’s Pi extension.";
export const LOOM_FIXTURE_FINAL =
  "The offline Raw Pi fixture published the reference view. It remains exploratory and unverified.";
export const LOOM_FIXTURE_SELECTION_FINAL =
  "The selected interval has been reviewed using Loom’s daemon-derived summary. The explanation remains exploratory and should be checked against the full research context.";

export interface PiPromptFixture {
  taskId: string;
  selection?: LoomSelection;
}

export interface HostedPiSession {
  readonly descriptor: LoomPiRuntimeDescriptor;
  readonly session: AgentSession;
  readonly recovery: "fresh" | "resumed" | "reconstructed";
  preparePrompt(input: PiPromptFixture): void;
  dispose(): void;
}

export interface PiSessionFactoryInput {
  projectId: string;
  sessionId: string;
  profile: LoomSessionProfile;
  cwd: string;
  agentDir: string;
  veil?: {
    api: LoadedVeilApi;
    project: VeilProject;
  };
  recovery?: {
    publicContext?: string;
    interruptedTaskIds: readonly string[];
  };
}

export interface PiSessionFactory {
  create(input: PiSessionFactoryInput): Promise<HostedPiSession>;
}

export interface DeterministicPiSessionFactoryOptions {
  tokensPerSecond?: number;
  preamble?: string;
  finalText?: string;
  outcome?: "success" | "error";
}

export interface DeterministicPiSessionFactoryDependencies {
  referenceBacktests: DailyFactorReferenceAdapter;
}

/** Uses Pi's official faux provider while exercising the real AgentSession and extension runtime. */
export class DeterministicPiSessionFactory implements PiSessionFactory {
  readonly #dependencies: DeterministicPiSessionFactoryDependencies;
  readonly #options: DeterministicPiSessionFactoryOptions;

  constructor(
    dependencies: DeterministicPiSessionFactoryDependencies,
    options: DeterministicPiSessionFactoryOptions = {},
  ) {
    this.#dependencies = dependencies;
    this.#options = options;
  }

  async create(input: PiSessionFactoryInput): Promise<HostedPiSession> {
    const faux = fauxProvider({
      api: "loom-faux-v0",
      provider: LOOM_FIXTURE_PROVIDER,
      models: [{ id: LOOM_FIXTURE_MODEL, name: "Loom deterministic fixture" }],
      tokenSize: { min: 2, max: 2 },
      ...(this.#options.tokensPerSecond === undefined
        ? {}
        : { tokensPerSecond: this.#options.tokensPerSecond }),
    });
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      modelsStore: new InMemoryModelsStore(),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);

    const settingsManager = SettingsManager.inMemory(
      {
        compaction: { enabled: false },
        retry: { enabled: false, provider: { maxRetries: 0 } },
      },
      { projectTrusted: false },
    );
    let taskId: string | undefined;
    const extensionFactories: InlineExtension[] = [
      createLoomReferenceBacktestExtension({
        publish: async () => {
          if (taskId === undefined) throw new Error("The Loom task context is unavailable");
          return this.#dependencies.referenceBacktests.publishCommitted({
            projectId: input.projectId,
            sessionId: input.sessionId,
            taskId,
          });
        },
      }),
    ];
    const tools = [LOOM_REFERENCE_BACKTEST_TOOL_NAME];
    if (input.profile === "veil") {
      const veil = input.veil;
      if (veil === undefined) throw new Error("The Veil project context is unavailable");
      extensionFactories.push(
        veil.api.api.createVeilExtension({
          projectLoader: async (cwd) => {
            if (cwd !== input.cwd) throw new Error("The Veil project ownership changed");
            return veil.project;
          },
        }),
      );
      tools.push(
        veil.api.api.VEIL_DATA_TOOL,
        veil.api.api.VEIL_BACKTEST_TOOL,
        veil.api.api.VEIL_MEMORY_TOOL,
      );
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: input.agentDir,
      settingsManager,
      extensionFactories,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt:
        input.profile === "veil"
          ? "You are running Loom's deterministic offline Veil fixture. Use only the supplied Loom and Veil tools."
          : "You are running Loom's deterministic offline fixture. Use only the supplied Loom tool.",
    });
    await resourceLoader.reload();
    const extensionErrors = resourceLoader.getExtensions().errors;
    if (extensionErrors.length > 0) {
      throw new Error("The Loom extension could not be loaded");
    }

    const sessionState = await resolvePiSessionManager(input);
    const { session } = await createAgentSession({
      cwd: input.cwd,
      agentDir: input.agentDir,
      model: faux.getModel(),
      modelRuntime,
      thinkingLevel: "off",
      tools,
      resourceLoader,
      sessionManager: sessionState.manager,
      settingsManager,
    });
    await session.bindExtensions({ mode: "print" });

    const descriptor = {
      format: "loom.pi-runtime.v0",
      package: "@earendil-works/pi-coding-agent",
      version: PI_VERSION,
      provider: LOOM_FIXTURE_PROVIDER,
      model: LOOM_FIXTURE_MODEL,
      mode: "offline-fixture",
      fingerprint:
        input.profile === "raw-pi"
          ? `pi-${PI_VERSION}__${LOOM_FIXTURE_PROVIDER}__${LOOM_FIXTURE_MODEL}`
          : `pi-${PI_VERSION}__${LOOM_FIXTURE_PROVIDER}__${LOOM_FIXTURE_MODEL}__veil-${input.veil?.api.version ?? "unavailable"}`,
    } as const satisfies LoomPiRuntimeDescriptor;

    return {
      descriptor,
      session,
      recovery: sessionState.recovery,
      preparePrompt: (fixture) => {
        taskId = fixture.taskId;
        if (this.#options.outcome === "error") {
          faux.setResponses([
            fauxAssistantMessage([], {
              stopReason: "error",
              errorMessage: "Private fixture failure: provider diagnostics stay in the daemon",
            }),
          ]);
          return;
        }
        if (fixture.selection !== undefined) {
          faux.setResponses([
            fauxAssistantMessage(this.#options.finalText ?? LOOM_FIXTURE_SELECTION_FINAL),
          ]);
          return;
        }
        faux.setResponses([
          fauxAssistantMessage(
            [
              fauxThinking("This deterministic thought must never enter Loom's public event log."),
              fauxText(this.#options.preamble ?? LOOM_FIXTURE_PREAMBLE),
              fauxToolCall(
                LOOM_REFERENCE_BACKTEST_TOOL_NAME,
                { target: "daily-factor" },
                { id: `${fixture.taskId}-tool-1` },
              ),
            ],
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage(this.#options.finalText ?? LOOM_FIXTURE_FINAL),
        ]);
      },
      dispose: () => session.dispose(),
    };
  }
}

const LOOM_PI_SESSION_MARKER = "veil-loom.runtime.v0";
const LOOM_PI_RECOVERY_CONTEXT = "veil-loom.recovery.v0";

async function resolvePiSessionManager(input: PiSessionFactoryInput): Promise<{
  manager: SessionManager;
  recovery: HostedPiSession["recovery"];
}> {
  const sessionDir = join(input.agentDir, "sessions");
  const id = piSessionId(input.projectId, input.sessionId);
  const matches = (await SessionManager.list(input.cwd, sessionDir)).filter(
    (candidate) => candidate.id === id,
  );
  if (matches.length > 1) throw new Error("The Loom Pi session identity is ambiguous");
  if (input.recovery === undefined) {
    if (matches.length > 0) throw new Error("The Loom Pi session already exists");
    const manager = SessionManager.create(input.cwd, sessionDir, { id });
    appendSessionMarker(manager, input);
    return { manager, recovery: "fresh" };
  }

  let manager: SessionManager;
  let recovery: HostedPiSession["recovery"];
  const match = matches[0];
  if (match === undefined) {
    manager = SessionManager.create(input.cwd, sessionDir, { id });
    appendSessionMarker(manager, input);
    recovery = "reconstructed";
    if (input.recovery.publicContext !== undefined) {
      manager.appendCustomMessageEntry(
        LOOM_PI_RECOVERY_CONTEXT,
        input.recovery.publicContext,
        false,
        { format: "loom.pi-recovery-context.v0", source: "public-events" },
      );
    }
  } else {
    manager = SessionManager.open(match.path, sessionDir, input.cwd);
    assertSessionMarker(manager, input);
    recovery = "resumed";
  }
  if (input.recovery.interruptedTaskIds.length > 0) {
    manager.appendCustomMessageEntry(
      LOOM_PI_RECOVERY_CONTEXT,
      "The previous Loom task was interrupted by a daemon restart. It has no successful terminal record; do not describe it as completed.",
      false,
      {
        format: "loom.pi-interruption-context.v0",
        taskIds: [...input.recovery.interruptedTaskIds],
      },
    );
  }
  return { manager, recovery };
}

function appendSessionMarker(manager: SessionManager, input: PiSessionFactoryInput): void {
  manager.appendCustomEntry(LOOM_PI_SESSION_MARKER, {
    format: LOOM_PI_SESSION_MARKER,
    projectId: input.projectId,
    sessionId: input.sessionId,
    profile: input.profile,
  });
}

function assertSessionMarker(manager: SessionManager, input: PiSessionFactoryInput): void {
  const matches = manager.getEntries().filter((entry) => {
    if (entry.type !== "custom" || entry.customType !== LOOM_PI_SESSION_MARKER) return false;
    const data = entry.data;
    return (
      data !== null &&
      typeof data === "object" &&
      "format" in data &&
      data.format === LOOM_PI_SESSION_MARKER &&
      "projectId" in data &&
      data.projectId === input.projectId &&
      "sessionId" in data &&
      data.sessionId === input.sessionId &&
      ("profile" in data ? data.profile === input.profile : input.profile === "raw-pi")
    );
  });
  if (matches.length !== 1) throw new Error("The Loom Pi session marker is invalid");
}

function piSessionId(projectId: string, sessionId: string): string {
  return `loom-${createHash("sha256").update(projectId).update("\0").update(sessionId).digest("hex").slice(0, 32)}`;
}
