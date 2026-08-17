"use client";

import type { LoomProjectReadinessResponse } from "@veilquant/loom-protocol";
import { useEffect, useState } from "react";
import { loadProjectReadiness } from "../lib/project-readiness";

export type ProjectReadinessState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "ready" | "invalid" | "unavailable"; readiness: LoomProjectReadinessResponse }
  | { status: "failed"; message: string };

export interface UseProjectReadinessOptions {
  enabled: boolean;
  daemonOrigin: string;
  projectId: string;
}

export function useProjectReadiness(options: UseProjectReadinessOptions): ProjectReadinessState {
  const [state, setState] = useState<ProjectReadinessState>({ status: "disabled" });

  useEffect(() => {
    if (!options.enabled) {
      setState({ status: "disabled" });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    void loadProjectReadiness({
      daemonOrigin: options.daemonOrigin,
      projectId: options.projectId,
      signal: controller.signal,
    }).then(
      (readiness) => {
        if (active) setState({ status: readiness.status, readiness });
      },
      (error: unknown) => {
        if (active && !controller.signal.aborted) {
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : "Project readiness could not load",
          });
        }
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [options.daemonOrigin, options.enabled, options.projectId]);

  return state;
}
