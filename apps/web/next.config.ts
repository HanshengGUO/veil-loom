import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/loom-daemon/v0/sessions/:sessionId/stream",
        destination: `${developmentDaemonOrigin()}/v0/sessions/:sessionId/stream`,
      },
    ];
  },
};

function developmentDaemonOrigin(): string {
  const input = process.env.LOOM_DAEMON_URL ?? "http://127.0.0.1:43120";
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "LOOM_DAEMON_URL must be an HTTP loopback origin without credentials or a path",
    );
  }
  return url.origin;
}

export default nextConfig;
