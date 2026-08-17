import { describe, expect, it } from "vitest";
import { resolveLoomStateRoot } from "../src/state-root.js";

describe("Loom state root", () => {
  it("honors an explicit state directory", () => {
    expect(
      resolveLoomStateRoot({ LOOM_STATE_DIR: "/var/lib/loom-test" }, "linux", "/home/me"),
    ).toBe("/var/lib/loom-test");
  });

  it("uses the XDG state location on Linux", () => {
    expect(resolveLoomStateRoot({ XDG_STATE_HOME: "/state" }, "linux", "/home/me")).toBe(
      "/state/veil-loom",
    );
  });

  it("uses Application Support on macOS", () => {
    expect(resolveLoomStateRoot({}, "darwin", "/Users/me")).toBe(
      "/Users/me/Library/Application Support/Veil Loom",
    );
  });

  it("uses local app data on Windows", () => {
    expect(resolveLoomStateRoot({ LOCALAPPDATA: "C:\\Local" }, "win32", "C:\\Users\\me")).toBe(
      "C:\\Local\\Veil Loom",
    );
  });

  it("rejects an empty override", () => {
    expect(() => resolveLoomStateRoot({ LOOM_STATE_DIR: "  " }, "linux", "/home/me")).toThrow(
      "LOOM_STATE_DIR must not be empty",
    );
  });
});
