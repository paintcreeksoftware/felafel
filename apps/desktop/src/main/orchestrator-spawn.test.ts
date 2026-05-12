// Unit tests for buildSpawnInvocation — the packaged-vs-dev decision
// for how to invoke the orchestrator's bundled `.mjs` entrypoint.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "electron";
import { buildSpawnInvocation } from "@felafel/desktop/main/orchestrator-spawn";

vi.mock("electron", () => ({
  app: { isPackaged: false },
}));

describe("buildSpawnInvocation", () => {
  const originalExecPath = process.execPath;

  beforeEach(() => {
    vi.mocked(app).isPackaged = false;
  });

  afterEach(() => {
    Object.defineProperty(process, "execPath", { value: originalExecPath });
  });

  it("invokes system node in dev mode (app.isPackaged=false)", () => {
    vi.mocked(app).isPackaged = false;
    const result = buildSpawnInvocation("/abs/path/index.mjs");
    expect(result).toEqual({
      command: "node",
      args: ["/abs/path/index.mjs"],
      extraEnv: {},
    });
  });

  it("invokes Electron's bundled node in packaged mode", () => {
    vi.mocked(app).isPackaged = true;
    Object.defineProperty(process, "execPath", { value: "/opt/Felafel/felafel" });
    const result = buildSpawnInvocation("/resources/orchestrator/index.mjs");
    expect(result).toEqual({
      command: "/opt/Felafel/felafel",
      args: ["--experimental-sqlite", "/resources/orchestrator/index.mjs"],
      extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });
});
