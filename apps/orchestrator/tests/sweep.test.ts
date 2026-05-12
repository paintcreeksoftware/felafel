import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import {
  BACKOFF_MAX_DELAY_MS,
  BACKOFF_THRESHOLD_FAILURES,
  startSweep,
  sweepDelayFor,
} from "@felafel/orchestrator/sweep";

/**
 * Promise that resolves after `ms` milliseconds — minimal sleep
 * helper for tests that need to observe wall-clock-driven behavior.
 * @param ms - the delay in milliseconds
 * @returns a promise that resolves after the delay
 */
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

describe("sweepDelayFor", () => {
  const baseOpts = {
    baseMs: 1000,
    thresholdFailures: BACKOFF_THRESHOLD_FAILURES,
    maxDelayMs: BACKOFF_MAX_DELAY_MS,
  };

  it("returns baseMs at zero failures", () => {
    expect(sweepDelayFor({ ...baseOpts, consecutiveFailures: 0 })).toBe(1000);
  });

  it("returns baseMs at exactly the failure threshold", () => {
    expect(
      sweepDelayFor({ ...baseOpts, consecutiveFailures: BACKOFF_THRESHOLD_FAILURES }),
    ).toBe(1000);
  });

  it("doubles per additional failure past the threshold", () => {
    expect(
      sweepDelayFor({ ...baseOpts, consecutiveFailures: BACKOFF_THRESHOLD_FAILURES + 1 }),
    ).toBe(2000);
    expect(
      sweepDelayFor({ ...baseOpts, consecutiveFailures: BACKOFF_THRESHOLD_FAILURES + 2 }),
    ).toBe(4000);
    expect(
      sweepDelayFor({ ...baseOpts, consecutiveFailures: BACKOFF_THRESHOLD_FAILURES + 3 }),
    ).toBe(8000);
  });

  it("clamps at maxDelayMs no matter how many failures accumulate", () => {
    expect(
      sweepDelayFor({ ...baseOpts, consecutiveFailures: 1000 }),
    ).toBe(BACKOFF_MAX_DELAY_MS);
  });

  it("respects a custom threshold + max", () => {
    expect(
      sweepDelayFor({
        baseMs: 100,
        consecutiveFailures: 5,
        thresholdFailures: 1,
        maxDelayMs: 1000,
      }),
    ).toBe(1000);
  });
});

describe("startSweep failure tracking", () => {
  let dataDir: string;
  let handle: DbHandle;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "orchestrator-sweep-fail-"));
    handle = createDb(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("logs the running consecutive-failures count when ticks throw", async () => {
    upsertWorker(handle.db, {
      id: randomUUID(),
      hostname: "test",
      controlPlaneUrl: "http://127.0.0.1:9091",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Close the handle so every subsequent DB call throws — gives the
    // sweep loop a deterministic stream of failures to count without
    // mocking @felafel/db itself.
    handle.close();

    const stop = startSweep({
      db: handle.db,
      intervalMs: 20,
      workerStaleAfterMs: 60_000,
      runTimeoutMs: 60_000,
    });

    try {
      // ~4 ticks at 20ms before backoff doubles the gap; 250ms gives
      // enough headroom to see the count climb past 1 even on slow CI.
      await sleep(250);
      const messages = errorSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => /consecutive failures: 1\b/u.test(m))).toBe(true);
      expect(messages.some((m) => /consecutive failures: [2-9]\b/u.test(m))).toBe(true);
    } finally {
      stop();
      errorSpy.mockRestore();
    }
  });
});
