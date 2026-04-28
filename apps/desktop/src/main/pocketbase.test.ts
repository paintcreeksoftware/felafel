// Tier 1 — unit tests for the pure helpers in pocketbase.ts. Runs in
// milliseconds, no PocketBase binary, no Electron, no filesystem beyond a
// temp dir.
//
// The `vi.mock("electron", ...)` stub lets us import pocketbase.ts in a Node
// (non-Electron) environment — the helpers we test don't actually call into
// the Electron app object, but the module-level `import { app } from
// "electron"` would fail without the mock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp/test-userdata",
    getAppPath: () => "/tmp/test-app",
  },
}));

import {
  binaryName,
  loadOrGenerateCredentials,
  platformDir,
  sanitizeUsername,
} from "./pocketbase";

describe("platformDir", () => {
  it.each([
    { platform: "linux" as const, arch: "x64", expected: "linux-x64" },
    { platform: "linux" as const, arch: "arm64", expected: "linux-arm64" },
    { platform: "darwin" as const, arch: "arm64", expected: "darwin-arm64" },
    { platform: "darwin" as const, arch: "x64", expected: "darwin-x64" },
    { platform: "win32" as const, arch: "x64", expected: "win-x64" },
  ])("returns $expected for ($platform, $arch)", ({ platform, arch, expected }) => {
    expect(platformDir(platform, arch)).toBe(expected);
  });
});

describe("binaryName", () => {
  it("returns pocketbase.exe on win32", () => {
    expect(binaryName("win32")).toBe("pocketbase.exe");
  });

  it.each(["linux", "darwin"] as const)("returns pocketbase on %s", (platform) => {
    expect(binaryName(platform)).toBe("pocketbase");
  });
});

describe("sanitizeUsername", () => {
  it.each([
    { input: "yingw787", expected: "yingw787" },
    { input: "Yingw787", expected: "yingw787" }, // lowercase
    { input: "ying.wang", expected: "ying.wang" }, // dots allowed
    { input: "ying_wang", expected: "ying_wang" }, // underscores allowed
    { input: "ying-wang", expected: "ying-wang" }, // hyphens allowed
    { input: "root@host", expected: "roothost" }, // @ stripped
    { input: "user!#$%name", expected: "username" }, // symbols stripped
    { input: "", expected: "admin" }, // empty -> admin fallback
    { input: "🦄", expected: "admin" }, // unicode stripped, fallback
    { input: "   ", expected: "admin" }, // whitespace stripped, fallback
  ])("sanitizes $input -> $expected", ({ input, expected }) => {
    expect(sanitizeUsername(input)).toBe(expected);
  });
});

describe("loadOrGenerateCredentials", () => {
  let tmpDir: string;
  let credsPath: string;
  const fixedCreds = { email: "test@felafel.local", password: "fixed-test-password-xyz" };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "felafel-test-"));
    credsPath = join(tmpDir, "admin.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates new credentials when no file exists", async () => {
    const fallback = vi.fn(() => fixedCreds);
    const creds = await loadOrGenerateCredentials(credsPath, fallback);

    expect(creds).toEqual(fixedCreds);
    expect(fallback).toHaveBeenCalledOnce();
    const persisted = JSON.parse(await readFile(credsPath, "utf8"));
    expect(persisted).toEqual(fixedCreds);
  });

  it("persists with mode 0600", async () => {
    await loadOrGenerateCredentials(credsPath, () => fixedCreds);
    const stats = await stat(credsPath);
    // Lower 9 bits of mode are the rwxrwxrwx permission bits.
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("loads existing credentials without invoking the fallback", async () => {
    const existingCreds = { email: "existing@felafel.local", password: "stored-password" };
    await loadOrGenerateCredentials(credsPath, () => existingCreds); // seed
    const fallback = vi.fn(() => fixedCreds);

    const creds = await loadOrGenerateCredentials(credsPath, fallback);

    expect(creds).toEqual(existingCreds);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("regenerates when the file is corrupted JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(credsPath, "{ this is not valid json");
    const fallback = vi.fn(() => fixedCreds);

    const creds = await loadOrGenerateCredentials(credsPath, fallback);

    expect(creds).toEqual(fixedCreds);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("regenerates when the file has missing fields", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(credsPath, JSON.stringify({ email: "only-email@host.local" }));
    const fallback = vi.fn(() => fixedCreds);

    const creds = await loadOrGenerateCredentials(credsPath, fallback);

    expect(creds).toEqual(fixedCreds);
    expect(fallback).toHaveBeenCalledOnce();
  });
});
