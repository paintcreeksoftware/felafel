// Unit tests for ensureDataDir — resolves the orchestrator's data
// directory (packaged vs dev) and creates it if missing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir } from "node:fs/promises";
import { app } from "electron";
import { ensureDataDir } from "@felafel/desktop/main/orchestrator-data-dir";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: vi.fn() },
}));

describe("ensureDataDir", () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockReset();
    vi.mocked(app).isPackaged = false;
    vi.mocked(app.getPath).mockReset();
  });

  it("returns a packaged userData/orchestrator path and mkdirs it", async () => {
    vi.mocked(app).isPackaged = true;
    vi.mocked(app.getPath).mockReturnValue("/Users/me/Library/Application Support/Felafel");
    const dir = await ensureDataDir();
    expect(dir).toBe("/Users/me/Library/Application Support/Felafel/orchestrator");
    expect(mkdir).toHaveBeenCalledExactlyOnceWith(dir, { recursive: true });
  });

  it("returns a dev path under the repo when not packaged", async () => {
    const dir = await ensureDataDir();
    expect(dir).toMatch(/\.dev-orchestrator-data$/);
    expect(mkdir).toHaveBeenCalledExactlyOnceWith(dir, { recursive: true });
  });

  it("creates the directory with recursive=true (no-op when it already exists)", async () => {
    await ensureDataDir();
    expect(mkdir).toHaveBeenCalledExactlyOnceWith(expect.any(String), { recursive: true });
  });
});
