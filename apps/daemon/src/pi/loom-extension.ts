import { Type } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  isLoomPublishedViewDescriptor,
  type LoomPublishedViewDescriptor,
} from "@veilquant/loom-protocol";

export const LOOM_REFERENCE_BACKTEST_TOOL_NAME = "loom_reference_backtest";

export interface LoomReferenceBacktestExtensionOptions {
  publish(): Promise<LoomPublishedViewDescriptor>;
}

export interface LoomReferenceBacktestToolResult {
  format: "loom.reference-backtest-tool-result.v0";
  view: LoomPublishedViewDescriptor;
}

/**
 * The first Loom extension surface is deliberately narrow. It invokes one explicit reference
 * adapter through Pi's tool lifecycle without granting the offline fixture arbitrary filesystem,
 * shell, or network access.
 */
export function createLoomReferenceBacktestExtension(
  options: LoomReferenceBacktestExtensionOptions,
): InlineExtension {
  return {
    name: "loom",
    hidden: true,
    factory(pi) {
      pi.registerTool({
        name: LOOM_REFERENCE_BACKTEST_TOOL_NAME,
        label: "Run reference backtest",
        description:
          "Import Loom's committed daily-factor reference output without network access.",
        parameters: Type.Object(
          { target: Type.Literal("daily-factor") },
          { additionalProperties: false },
        ),
        async execute(_toolCallId, _parameters, signal) {
          if (signal?.aborted) throw new Error("The reference backtest was cancelled");
          const view = await options.publish();
          if (signal?.aborted) throw new Error("The reference backtest was cancelled");
          return {
            content: [
              {
                type: "text",
                text: "The committed daily-factor reference view is ready.",
              },
            ],
            details: {
              format: "loom.reference-backtest-tool-result.v0",
              view,
            } satisfies LoomReferenceBacktestToolResult,
          };
        },
      });
    },
  };
}

export function publishedViewFromToolResult(
  input: unknown,
): LoomPublishedViewDescriptor | undefined {
  if (input === null || typeof input !== "object" || !("details" in input)) return undefined;
  const details = input.details;
  if (
    details === null ||
    typeof details !== "object" ||
    !("format" in details) ||
    details.format !== "loom.reference-backtest-tool-result.v0" ||
    !("view" in details) ||
    !isLoomPublishedViewDescriptor(details.view)
  ) {
    return undefined;
  }
  return details.view;
}
