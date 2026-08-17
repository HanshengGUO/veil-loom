"use client";

import { useEffect, useState } from "react";
import { bootstrapDaemonSession } from "../lib/daemon-auth";
import { type SessionConnectionState, SessionEventStream } from "../lib/session-event-stream";
import { createSessionProjection, type SessionProjection } from "../lib/session-projection";

export type BrowserConnectionState = SessionConnectionState | { status: "disabled"; attempt: 0 };

export interface UseSessionEventStreamOptions {
  enabled: boolean;
  daemonOrigin: string;
  projectId: string;
  sessionId: string;
}

export function useSessionEventStream(options: UseSessionEventStreamOptions): {
  projection: SessionProjection;
  connection: BrowserConnectionState;
} {
  const [projection, setProjection] = useState(() =>
    createSessionProjection(options.projectId, options.sessionId),
  );
  const [connection, setConnection] = useState<BrowserConnectionState>(() =>
    options.enabled ? { status: "connecting", attempt: 0 } : { status: "disabled", attempt: 0 },
  );

  useEffect(() => {
    const initial = createSessionProjection(options.projectId, options.sessionId);
    setProjection(initial);
    if (!options.enabled) {
      setConnection({ status: "disabled", attempt: 0 });
      return;
    }

    let active = true;
    const stream = new SessionEventStream({
      basePath: options.daemonOrigin,
      projectId: options.projectId,
      sessionId: options.sessionId,
      authorize: () => bootstrapDaemonSession(options.daemonOrigin),
      onProjection: (next) => {
        if (active) setProjection(next);
      },
      onConnection: (next) => {
        if (active) setConnection(next);
      },
    });
    stream.start();
    return () => {
      active = false;
      stream.stop();
    };
  }, [options.daemonOrigin, options.enabled, options.projectId, options.sessionId]);

  return { projection, connection };
}
