// Regression guards for `applyAppIdentity` — the runtime tweaks that
// make the Electron process identify as "Felafel" instead of inheriting
// the binary's "electron" identity. These are call-site assertions; the
// visible outcomes (icon, dock tooltip, menubar) are integration-level
// surfaces that can only be verified by running a built app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "electron";
import { applyAppIdentity } from "@felafel/desktop/main/desktop";
import { BRAND_NAME, Platform } from "@felafel/desktop/main/constants";

vi.mock("electron", () => ({
  app: {
    setName: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: vi.fn(),
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  globalShortcut: { register: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

describe("applyAppIdentity", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.mocked(app.setName).mockClear();
    vi.mocked(app.commandLine.appendSwitch).mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("sets the app name to Felafel on every platform", () => {
    for (const platform of [Platform.LINUX, Platform.MACOS, Platform.WINDOWS]) {
      vi.mocked(app.setName).mockClear();
      Object.defineProperty(process, "platform", { value: platform });
      applyAppIdentity();
      expect(app.setName).toHaveBeenCalledExactlyOnceWith(BRAND_NAME);
    }
  });

  it("appends the --class=Felafel Chromium switch on Linux (drives X11 WM_CLASS)", () => {
    Object.defineProperty(process, "platform", { value: Platform.LINUX });
    applyAppIdentity();
    expect(app.commandLine.appendSwitch).toHaveBeenCalledExactlyOnceWith("class", BRAND_NAME);
  });

  it("does not append --class on macOS or Windows (the flag is X11-specific)", () => {
    for (const platform of [Platform.MACOS, Platform.WINDOWS]) {
      vi.mocked(app.commandLine.appendSwitch).mockClear();
      Object.defineProperty(process, "platform", { value: platform });
      applyAppIdentity();
      expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    }
  });
});
