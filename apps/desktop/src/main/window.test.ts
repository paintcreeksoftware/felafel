// Regression guards for the BrowserWindow lifecycle helpers in
// window.ts: construction, external-link allowlist, renderer load.
// All three are thin Electron-API wrappers, so the tests are
// call-site assertions against mocked Electron — the visible
// outcomes (a window appearing on screen, links opening in the OS
// browser) are integration-level surfaces that can only be verified
// by running a built app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserWindow, shell } from "electron";
import { buildBrowserWindow, loadRenderer, wireExternalLinkAllowlist } from "@felafel/desktop/main/window";
import { BRAND_NAME, DesktopEnvVars, WindowSize } from "@felafel/desktop/main/constants";

vi.mock("electron", () => {
  const BrowserWindowMock = vi.fn(function (this: Record<string, unknown>, opts: unknown) {
    this.constructorOpts = opts;
    this.webContents = { setWindowOpenHandler: vi.fn() };
    this.loadURL = vi.fn().mockResolvedValue(null);
    this.loadFile = vi.fn().mockResolvedValue(null);
  });
  return {
    BrowserWindow: BrowserWindowMock,
    shell: { openExternal: vi.fn().mockResolvedValue(null) },
  };
});

// Vite injects the `?asset` import as a string path at build time;
// at test time we substitute a fixed stub so the import resolves.
vi.mock("../../build/icon.png?asset", () => ({ default: "/stub/icon.png" }));

describe("buildBrowserWindow", () => {
  beforeEach(() => {
    vi.mocked(BrowserWindow).mockClear();
  });

  it("sets title, dimensions, and icon hint", () => {
    buildBrowserWindow();
    const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as {
      width: number;
      height: number;
      title: string;
      icon: string;
    };
    expect(opts.width).toBe(WindowSize.WIDTH);
    expect(opts.height).toBe(WindowSize.HEIGHT);
    expect(opts.title).toBe(BRAND_NAME);
    expect(opts.icon).toBeDefined();
  });

  it("enables context isolation and disables the sandbox in webPreferences", () => {
    buildBrowserWindow();
    const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as {
      webPreferences: { contextIsolation: boolean; sandbox: boolean; preload: string };
    };
    expect(opts.webPreferences.contextIsolation).toBe(true);
    expect(opts.webPreferences.sandbox).toBe(false);
    expect(opts.webPreferences.preload).toMatch(/preload[\\/]index\.mjs$/u);
  });
});

describe("wireExternalLinkAllowlist", () => {
  it("delegates https URLs to shell.openExternal and denies in-window open", () => {
    const win = new BrowserWindow();
    wireExternalLinkAllowlist(win);
    const handler = vi.mocked(win.webContents.setWindowOpenHandler).mock.calls[0]?.[0];
    expect(handler).toBeDefined();
    if (!handler) {return;}

    const result = handler({ url: "https://example.com/", frameName: "", features: "", disposition: "default", referrer: { url: "", policy: "default" }, postBody: undefined });
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith("https://example.com/");
    expect(result).toEqual({ action: "deny" });
  });

  it("denies non-https URLs without calling shell.openExternal", () => {
    const win = new BrowserWindow();
    wireExternalLinkAllowlist(win);
    const handler = vi.mocked(win.webContents.setWindowOpenHandler).mock.calls[0]?.[0];
    if (!handler) {throw new Error("openHandler not registered");}

    vi.mocked(shell.openExternal).mockClear();
    // eslint-disable-next-line no-script-url -- this is the literal scheme the allowlist is meant to reject
    const jsUrl = "javascript:alert(1)";
    for (const url of ["file:///etc/passwd", jsUrl, "http://insecure.local/"]) {
      const result = handler({ url, frameName: "", features: "", disposition: "default", referrer: { url: "", policy: "default" }, postBody: undefined });
      expect(result).toEqual({ action: "deny" });
    }
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

describe("loadRenderer", () => {
  const originalEnv = process.env[DesktopEnvVars.ELECTRON_RENDERER_URL];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[DesktopEnvVars.ELECTRON_RENDERER_URL];
    } else {
      process.env[DesktopEnvVars.ELECTRON_RENDERER_URL] = originalEnv;
    }
  });

  it("calls loadURL with the dev-server URL when ELECTRON_RENDERER_URL is set", async () => {
    process.env[DesktopEnvVars.ELECTRON_RENDERER_URL] = "http://localhost:5173/";
    const win = new BrowserWindow();
    await loadRenderer(win);
    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith("http://localhost:5173/");
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it("falls back to loadFile when ELECTRON_RENDERER_URL is unset", async () => {
    delete process.env[DesktopEnvVars.ELECTRON_RENDERER_URL];
    const win = new BrowserWindow();
    await loadRenderer(win);
    expect(win.loadFile).toHaveBeenCalledOnce();
    expect(vi.mocked(win.loadFile).mock.calls[0]?.[0]).toMatch(/renderer[\\/]index\.html$/u);
    expect(win.loadURL).not.toHaveBeenCalled();
  });
});
