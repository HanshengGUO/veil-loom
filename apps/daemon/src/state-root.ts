import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function resolveLoomStateRoot(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = homedir(),
): string {
  const paths = platform === "win32" ? win32 : posix;
  const override = environment.LOOM_STATE_DIR;
  if (override !== undefined) {
    if (override.trim().length === 0) {
      throw new Error("LOOM_STATE_DIR must not be empty");
    }
    return paths.resolve(override);
  }

  if (platform === "darwin") {
    return paths.join(homeDirectory, "Library", "Application Support", "Veil Loom");
  }

  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    return paths.join(
      localAppData?.trim() || paths.join(homeDirectory, "AppData", "Local"),
      "Veil Loom",
    );
  }

  const xdgStateHome = environment.XDG_STATE_HOME;
  return paths.join(
    xdgStateHome?.trim() || paths.join(homeDirectory, ".local", "state"),
    "veil-loom",
  );
}
