import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const LOOM_FIXTURE_TOOL_NAME = "loom_fixture_inspect";

/**
 * The first Loom extension surface is deliberately narrow. It proves that Loom is hosted inside
 * Pi's extension/tool lifecycle without granting the offline fixture arbitrary filesystem or shell
 * access. The reference backtest adapter will replace this fixture-only tool in the next slice.
 */
export function createLoomFixtureExtension(): InlineExtension {
  return {
    name: "loom",
    hidden: true,
    factory(pi) {
      pi.registerTool({
        name: LOOM_FIXTURE_TOOL_NAME,
        label: "Inspect deterministic fixture",
        description: "Inspect Loom's committed daily-factor fixture without network access.",
        parameters: Type.Object(
          { target: Type.Literal("daily-factor") },
          { additionalProperties: false },
        ),
        async execute(_toolCallId, parameters, signal) {
          if (signal?.aborted) throw new Error("The fixture inspection was cancelled");
          return {
            content: [
              {
                type: "text",
                text: `The ${parameters.target} fixture is available for an exploratory run.`,
              },
            ],
            details: { fixture: parameters.target, format: "loom.fixture-result.v0" },
          };
        },
      });
    },
  };
}
