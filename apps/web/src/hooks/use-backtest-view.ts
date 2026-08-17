"use client";

import type { LoomPublishedViewDescriptor } from "@veilquant/loom-protocol";
import { useEffect, useState } from "react";
import { type BacktestViewResources, loadBacktestViewResources } from "../lib/backtest-view";

export type BacktestViewState =
  | { status: "waiting" }
  | { status: "loading" }
  | { status: "ready"; resources: BacktestViewResources }
  | { status: "failed"; message: string };

export interface UseBacktestViewOptions {
  enabled: boolean;
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
  descriptor: LoomPublishedViewDescriptor | undefined;
}

export function useBacktestView(options: UseBacktestViewOptions): BacktestViewState {
  const [state, setState] = useState<BacktestViewState>({ status: "waiting" });

  useEffect(() => {
    if (!options.enabled || options.descriptor === undefined) {
      setState({ status: "waiting" });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    void loadBacktestViewResources({
      daemonOrigin: options.daemonOrigin,
      projectId: options.projectId,
      sessionId: options.sessionId,
      descriptor: options.descriptor,
      signal: controller.signal,
    }).then(
      (resources) => {
        if (active) setState({ status: "ready", resources });
      },
      (error: unknown) => {
        if (active && !controller.signal.aborted) {
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : "The research view could not load",
          });
        }
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    options.daemonOrigin,
    options.descriptor,
    options.enabled,
    options.projectId,
    options.sessionId,
  ]);

  return state;
}
