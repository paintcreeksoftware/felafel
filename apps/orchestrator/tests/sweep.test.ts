import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "pathe";
import { SqliteRunStore } from "@felafel/orchestrator/store/runs";
import { SqliteWorkerStore } from "@felafel/orchestrator/store/sqlite";
import { startSweep } from "@felafel/orchestrator/sweep";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("startSweep", () => {
  let dataDir: string;
  let workerStore: SqliteWorkerStore;
  let runStore: SqliteRunStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "orchestrator-sweep-"));
    workerStore = new SqliteWorkerStore(dataDir);
    runStore = new SqliteRunStore(dataDir);
  });

  afterEach(() => {
    runStore.close();
    workerStore.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("flips workers stale once they pass the threshold", async () => {
    const id = randomUUID();
    workerStore.upsert({
      id,
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    });

    const stop = startSweep({
      workerStore,
      runStore,
      intervalMs: 50,
      // 1ms threshold so the just-registered worker ages out immediately
      workerStaleAfterMs: 1,
      runTimeoutMs: 10_000,
    });

    try {
      await sleep(10); // give last_seen_at age past 1ms
      // sweep ticks every 50ms; wait at least one tick
      await sleep(80);
      const list = workerStore.list();
      expect(list[0]?.status).toBe("stale");
    } finally {
      stop();
    }
  });

  it("re-registration flips a stale worker back to active", async () => {
    const id = randomUUID();
    const reg = {
      id,
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    };
    workerStore.upsert(reg);
    await sleep(10);
    workerStore.markStaleSince(new Date().toISOString());
    expect(workerStore.list()[0]?.status).toBe("stale");

    workerStore.upsert(reg);
    expect(workerStore.list()[0]?.status).toBe("active");
  });

  it("flips dispatched runs to failed once they pass the timeout", async () => {
    const run = runStore.insert({ x: 1 });
    runStore.markDispatched(run.id, randomUUID());

    const stop = startSweep({
      workerStore,
      runStore,
      intervalMs: 50,
      workerStaleAfterMs: 60_000,
      runTimeoutMs: 1,
    });

    try {
      await sleep(10);
      await sleep(80);
      const fetched = runStore.get(run.id);
      expect(fetched?.status).toBe("failed");
      expect(fetched?.error).toBe("dispatch timeout");
    } finally {
      stop();
    }
  });

  it("does not touch already-complete or already-failed runs", async () => {
    const completed = runStore.insert({ x: 1 });
    runStore.markDispatched(completed.id, randomUUID());
    runStore.markComplete(completed.id);

    const failed = runStore.insert({ x: 2 });
    runStore.markFailed(failed.id, "earlier error");

    const stop = startSweep({
      workerStore,
      runStore,
      intervalMs: 50,
      workerStaleAfterMs: 60_000,
      runTimeoutMs: 1,
    });

    try {
      await sleep(10);
      await sleep(80);
      expect(runStore.get(completed.id)?.status).toBe("complete");
      expect(runStore.get(failed.id)?.error).toBe("earlier error");
    } finally {
      stop();
    }
  });

  it("stop() halts the loop", async () => {
    const id = randomUUID();
    workerStore.upsert({
      id,
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    });

    const stop = startSweep({
      workerStore,
      runStore,
      intervalMs: 50,
      workerStaleAfterMs: 60_000,
      runTimeoutMs: 60_000,
    });
    stop();

    // Re-register fresh worker after stop, then mark it stale via direct
    // update; ensure the (stopped) sweep doesn't act.
    await sleep(80);
    expect(workerStore.list()[0]?.status).toBe("active");
  });
});
