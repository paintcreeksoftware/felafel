// Tier 2 — integration test for the PocketBase sidecar lifecycle. Spawns
// the real binary at a random port pointing at a temp pb_data dir, exercises
// startPocketBase + superuser upsert + auth, then verifies stopPocketBase
// cleans up. Excluded from the default `pnpm test` run; opt in via
// `pnpm test:integration`.
//
// Requires `apps/desktop/resources/pocketbase/<host>/pocketbase` to exist —
// `pnpm install`'s postinstall handles that.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

let userDataDir: string;
let appDir: string;

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir,
    getAppPath: () => appDir,
  },
}));

import { getCredentials, startPocketBase, stopPocketBase } from "./pocketbase";

describe("PocketBase sidecar lifecycle", () => {
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "felafel-pb-"));
    // Resolve the apps/desktop directory (this test file is in src/main/).
    appDir = join(here, "..", "..");
  });

  afterEach(async () => {
    await stopPocketBase();
    await rm(userDataDir, { recursive: true, force: true });
  });

  it("spawns PocketBase, upserts a superuser, and authenticates over HTTP", async () => {
    const url = await startPocketBase();

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const health = await fetch(`${url}/api/health`);
    expect(health.ok).toBe(true);

    const creds = getCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.email).toMatch(/@felafel\.local$/);
    expect(creds!.password).toHaveLength(32); // 24 bytes base64url-encoded

    const auth = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: creds!.email, password: creds!.password }),
    });
    expect(auth.ok).toBe(true);
    const body = (await auth.json()) as { token?: string };
    expect(typeof body.token).toBe("string");
    expect(body.token!.length).toBeGreaterThan(0);
  }, 30_000);

  it("stopPocketBase cleans up the child process", async () => {
    const url = await startPocketBase();
    await stopPocketBase();

    // After stop, the server should no longer respond.
    await new Promise((r) => setTimeout(r, 500));
    const fetched = await fetch(`${url}/api/health`).catch(() => null);
    expect(fetched).toBeNull();
  }, 30_000);

  it("is idempotent across consecutive starts against the same data dir", async () => {
    const firstUrl = await startPocketBase();
    expect(firstUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await stopPocketBase();

    const secondUrl = await startPocketBase();
    expect(secondUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // Same userData dir means same admin.json, so creds should match.
    const creds = getCredentials();
    expect(creds).not.toBeNull();

    const auth = await fetch(`${secondUrl}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: creds!.email, password: creds!.password }),
    });
    expect(auth.ok).toBe(true);
  }, 60_000);
});
