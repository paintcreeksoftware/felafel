// Tier 2 — integration test for the orchestrator sidecar lifecycle. Spawns
// the real Node bundle at a random port pointing at a temp data dir,
// exercises start + /health + a worker upsert + verifies SQLite file is
// created, then verifies stop cleans up. Excluded from the default
// `pnpm test` run; opt in via `pnpm test:integration`.
//
// Requires `apps/orchestrator/dist/index.mjs` to exist — run
// `pnpm --filter @felafel/orchestrator build` first.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const here = import.meta.dirname;

let userDataDir: string;

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataDir,
    getAppPath: () => join(here, "..", ".."),
  },
}));

import { createLogger, Service } from "@felafel/logs";
import { OrchestratorManager } from "@felafel/desktop/main/orchestrator";
import { TailscaleManager } from "@felafel/tailscale";

const testLogger = createLogger({ service: Service.DESKTOP_MAIN });

const devDataDir = join(here, "..", "..", ".dev-orchestrator-data");

describe("OrchestratorManager lifecycle", () => {
  let manager: OrchestratorManager;

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "felafel-orch-"));
    // Real TailscaleManager — at runtime its findBinary will return null
    // on hosts without Tailscale (CI), and the manager treats that as
    // "skip serve setup" rather than failing. No mocking needed.
    manager = new OrchestratorManager(new TailscaleManager(), testLogger);
  });

  afterEach(async () => {
    await manager.stop();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(devDataDir, { recursive: true, force: true });
  });

  it("spawns the orchestrator and serves /health", async () => {
    const url = await manager.start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);

    const health = await fetch(`${url}/health`);
    expect(health.ok).toBe(true);
    await expect(health.json()).resolves.toEqual({ ok: true });
  }, 30_000);

  it("registers and lists workers across the spawned process", async () => {
    const url = await manager.start();
    const reg = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      hostname: "integration-test",
      controlPlaneUrl: "http://127.0.0.1:9091",
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
    await manager.start();
    expect(existsSync(join(devDataDir, "orchestrator.sqlite"))).toBe(true);
  }, 30_000);

  it("stop() cleans up the child process", async () => {
    const url = await manager.start();
    await manager.stop();

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
    const fetched = await fetch(`${url}/health`).catch(() => null);
    expect(fetched).toBeNull();
  }, 30_000);
});
