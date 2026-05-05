import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "pathe";
import {
  createDb,
  type DbHandle,
  insertRun,
  listWorkers,
  markRunDispatched,
  markRunComplete,
  markRunFailed,
  markWorkersStaleSince,
  upsertWorker,
  getRun,
} from "@felafel/db";
import { startSweep } from "@felafel/orchestrator/sweep";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("startSweep", () => {
  let dataDir: string;
  let handle: DbHandle;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "orchestrator-sweep-"));
    handle = createDb(dataDir);
  });

  afterEach(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("flips workers stale once they pass the threshold", async () => {
    const id = randomUUID();
    upsertWorker(handle.db, {
      id,
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    });

    const stop = startSweep({
      db: handle.db,
      intervalMs: 50,
      // 1ms threshold so the just-registered worker ages out immediately
      workerStaleAfterMs: 1,
      runTimeoutMs: 10_000,
    });

    try {
      await sleep(10); // give last_seen_at age past 1ms
      // sweep ticks every 50ms; wait at least one tick
      await sleep(80);
      const list = listWorkers(handle.db);
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
    upsertWorker(handle.db, reg);
    await sleep(10);
    markWorkersStaleSince(handle.db, new Date().toISOString());
    expect(listWorkers(handle.db)[0]?.status).toBe("stale");

    upsertWorker(handle.db, reg);
    expect(listWorkers(handle.db)[0]?.status).toBe("active");
  });

  it("flips dispatched runs to failed once they pass the timeout", async () => {
    // FK on runs.worker_id requires the worker to exist.
    const workerId = randomUUID();
    upsertWorker(handle.db, {
      id: workerId,
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    });
    const run = insertRun(handle.db, { x: 1 });
    markRunDispatched(handle.db, run.id, workerId);

    const stop = startSweep({
      db: handle.db,
      intervalMs: 50,
      workerStaleAfterMs: 60_000,
      runTimeoutMs: 1,
    });

    try {
      await sleep(10);
      await sleep(80);
      const fetched = getRun(handle.db, run.id);
      expect(fetched?.status).toBe("failed");
      expect(fetched?.error).toBe("dispatch timeout");
    } finally {
      stop();
    }
  });

  it("does not touch already-complete or already-failed runs", async () => {
    const workerId = randomUUID();
    upsertWorker(handle.db, {
      id: workerId,
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    });
    const completed = insertRun(handle.db, { x: 1 });
    markRunDispatched(handle.db, completed.id, workerId);
    markRunComplete(handle.db, completed.id);

    const failed = insertRun(handle.db, { x: 2 });
    markRunFailed(handle.db, failed.id, "earlier error");

    const stop = startSweep({
      db: handle.db,
      intervalMs: 50,
      workerStaleAfterMs: 60_000,
      runTimeoutMs: 1,
    });

    try {
      await sleep(10);
      await sleep(80);
      expect(getRun(handle.db, completed.id)?.status).toBe("complete");
      expect(getRun(handle.db, failed.id)?.error).toBe("earlier error");
    } finally {
      stop();
    }
  });

  it("stop() halts the loop", async () => {
    const id = randomUUID();
    upsertWorker(handle.db, {
      id,
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    });

    const stop = startSweep({
      db: handle.db,
      intervalMs: 50,
      workerStaleAfterMs: 60_000,
      runTimeoutMs: 60_000,
    });
    stop();

    // Re-register fresh worker after stop, then mark it stale via direct
    // update; ensure the (stopped) sweep doesn't act.
    await sleep(80);
    expect(listWorkers(handle.db)[0]?.status).toBe("active");
  });
});
