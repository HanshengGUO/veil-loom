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
  ModelRuntime,
  VERSION as PI_VERSION,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { LoomPiRuntimeDescriptor } from "@veilquant/loom-protocol";
import type { DailyFactorReferenceAdapter } from "../reference-backtest/reference-adapter.js";
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

export interface PiPromptFixture {
  taskId: string;
}

export interface HostedPiSession {
  readonly descriptor: LoomPiRuntimeDescriptor;
  readonly session: AgentSession;
  preparePrompt(input: PiPromptFixture): void;
  dispose(): void;
}

export interface PiSessionFactoryInput {
  projectId: string;
  sessionId: string;
  cwd: string;
  agentDir: string;
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
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: input.agentDir,
      settingsManager,
      extensionFactories: [
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
      ],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt:
        "You are running Loom's deterministic offline fixture. Use only the supplied Loom tool.",
    });
    await resourceLoader.reload();
    const extensionErrors = resourceLoader.getExtensions().errors;
    if (extensionErrors.length > 0) {
      throw new Error("The Loom extension could not be loaded");
    }

    const { session } = await createAgentSession({
      cwd: input.cwd,
      agentDir: input.agentDir,
      model: faux.getModel(),
      modelRuntime,
      thinkingLevel: "off",
      tools: [LOOM_REFERENCE_BACKTEST_TOOL_NAME],
      resourceLoader,
      sessionManager: SessionManager.inMemory(input.cwd),
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
      fingerprint: `pi-${PI_VERSION}__${LOOM_FIXTURE_PROVIDER}__${LOOM_FIXTURE_MODEL}`,
    } as const satisfies LoomPiRuntimeDescriptor;

    return {
      descriptor,
      session,
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
