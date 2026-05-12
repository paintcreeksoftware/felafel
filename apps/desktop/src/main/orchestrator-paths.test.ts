// Unit tests for resolveScriptPath — the orchestrator entrypoint
// resolver that consolidates fake-bundle override, packaged-resources
// path, and dev-tree path, plus the existsSync precondition.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { app } from "electron";
import { resolveScriptPath } from "@felafel/desktop/main/orchestrator-paths";
import { DesktopEnvVars } from "@felafel/desktop/main/constants";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: false } }));

describe("resolveScriptPath", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(app).isPackaged = false;
    delete process.env[DesktopEnvVars.FELAFEL_ORCHESTRATOR_FAKE_BUNDLE];
  });

  afterEach(() => {
    delete process.env[DesktopEnvVars.FELAFEL_ORCHESTRATOR_FAKE_BUNDLE];
  });

  it("returns the fake-bundle override when the env var is set", () => {
    process.env[DesktopEnvVars.FELAFEL_ORCHESTRATOR_FAKE_BUNDLE] = "/fake/bundle.mjs";
    expect(resolveScriptPath()).toBe("/fake/bundle.mjs");
  });

  it("returns the packaged-resources path when app.isPackaged is true", () => {
    vi.mocked(app).isPackaged = true;
    Object.defineProperty(process, "resourcesPath", { value: "/Resources" });
    expect(resolveScriptPath()).toBe("/Resources/orchestrator/index.mjs");
  });

  it("returns a dev path inside the orchestrator dist tree otherwise", () => {
    expect(resolveScriptPath()).toMatch(/orchestrator\/dist\/index\.mjs$/u);
  });

  it("throws when the resolved path does not exist on disk", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(() => resolveScriptPath()).toThrow(/bundle missing at/u);
  });
});
