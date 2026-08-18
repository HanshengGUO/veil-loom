"use client";

import type { LoomProjectExperimentsResponse } from "@veilquant/loom-protocol";
import { useEffect, useState } from "react";
import { fetchProjectExperiments } from "../lib/experiment-client";

export type ProjectExperimentsState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "ready"; index: LoomProjectExperimentsResponse }
  | { status: "error"; message: string };

export function useProjectExperiments(options: {
  enabled: boolean;
  daemonOrigin: string;
  projectId: string;
}): ProjectExperimentsState {
  const [state, setState] = useState<ProjectExperimentsState>(() =>
    options.enabled ? { status: "loading" } : { status: "disabled" },
  );

  useEffect(() => {
    if (!options.enabled) {
      setState({ status: "disabled" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchProjectExperiments({
      daemonOrigin: options.daemonOrigin,
      projectId: options.projectId,
      signal: controller.signal,
    }).then(
      (index) => {
        if (!controller.signal.aborted) setState({ status: "ready", index });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Experiment history is unavailable.",
        });
      },
    );
    return () => controller.abort();
  }, [options.daemonOrigin, options.enabled, options.projectId]);

  return state;
}
