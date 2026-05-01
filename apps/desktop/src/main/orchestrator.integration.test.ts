// Tier 2 — integration test for the orchestrator sidecar lifecycle. Spawns
// the real Node bundle at a random port pointing at a temp data dir,
// exercises startOrchestrator + /health + a worker upsert + verifies SQLite
// file is created, then verifies stopOrchestrator cleans up. Excluded from
// the default `pnpm test` run; opt in via `pnpm test:integration`.
//
// Requires `apps/orchestrator/dist/index.mjs` to exist — run
// `pnpm --filter @felafel/orchestrator build` first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";

const here = import.meta.dirname;

let userDataDir: string;

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir,
    getAppPath: () => join(here, "..", ".."),
  },
}));

import { startOrchestrator, stopOrchestrator } from "./orchestrator";

const devDataDir = join(here, "..", "..", ".dev-orchestrator-data");

describe("orchestrator sidecar lifecycle", () => {
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "felafel-orch-"));
  });

  afterEach(async () => {
    await stopOrchestrator();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(devDataDir, { recursive: true, force: true });
  });

  it("spawns the orchestrator and serves /health", async () => {
    const url = await startOrchestrator();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const health = await fetch(`${url}/health`);
    expect(health.ok).toBe(true);
    await expect(health.json()).resolves.toEqual({ ok: true });
  }, 30_000);

  it("registers and lists workers across the spawned process", async () => {
    const url = await startOrchestrator();
    const reg = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      hostname: "integration-test",
    };

    const post = await fetch(`${url}/workers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reg),
    });
    expect(post.ok).toBe(true);

    const list = await fetch(`${url}/workers`);
    const workers = (await list.json()) as { id: string }[];
    expect(workers).toHaveLength(1);
    expect(workers[0]?.id).toBe(reg.id);
  }, 30_000);

  it("creates a SQLite file under the data dir", async () => {
    await startOrchestrator();
    expect(existsSync(join(devDataDir, "orchestrator.sqlite"))).toBe(true);
  }, 30_000);

  it("stopOrchestrator cleans up the child process", async () => {
    const url = await startOrchestrator();
    await stopOrchestrator();

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    const fetched = await fetch(`${url}/health`).catch(() => null);
    expect(fetched).toBeNull();
  }, 30_000);
});
