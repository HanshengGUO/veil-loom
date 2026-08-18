"use client";

import type { LoomExperimentEvidenceResponse } from "@veilquant/loom-protocol";
import { useEffect, useState } from "react";
import { fetchExperimentEvidence } from "../lib/experiment-client";

export type ExperimentEvidenceState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "ready"; evidence: LoomExperimentEvidenceResponse }
  | { status: "error"; message: string };

export interface UseExperimentEvidenceOptions {
  enabled: boolean;
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
  experimentId: string;
  attemptId: string;
}

export function useExperimentEvidence(
  options: UseExperimentEvidenceOptions,
): ExperimentEvidenceState {
  const [state, setState] = useState<ExperimentEvidenceState>(() =>
    options.enabled ? { status: "loading" } : { status: "disabled" },
  );

  useEffect(() => {
    if (!options.enabled) {
      setState({ status: "disabled" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchExperimentEvidence({
      daemonOrigin: options.daemonOrigin,
      projectId: options.projectId,
      sessionId: options.sessionId,
      experimentId: options.experimentId,
      attemptId: options.attemptId,
      signal: controller.signal,
    }).then(
      (evidence) => {
        if (!controller.signal.aborted) setState({ status: "ready", evidence });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Experiment evidence is unavailable.",
        });
      },
    );
    return () => controller.abort();
  }, [
    options.attemptId,
    options.daemonOrigin,
    options.enabled,
    options.experimentId,
    options.projectId,
    options.sessionId,
  ]);

  return state;
}
