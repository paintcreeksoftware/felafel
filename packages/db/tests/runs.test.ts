// Behavioral tests for the runs query functions, run against a real
// SQLite database in a tmpdir. Mirrors apps/orchestrator/tests/runs-store.test.ts
// so D6's cutover is a drop-in.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type WorkerRegistration } from "@felafel/contracts";
import { createDb, type DbHandle, upsertWorker } from "@felafel/db";
import {
  getRun,
  insertRun,
  listRuns,
  markRunComplete,
  markRunDispatched,
  markRunFailed,
  markRunsTimedOutSince,
} from "@felafel/db/queries/runs";

const SLEEP_MS = 5;

// Two distinct workers — runs.worker_id has a FK reference to
// workers.worker_id, so the worker must exist before markRunDispatched.
const workerA: WorkerRegistration = {
  id: "11111111-2222-4333-8444-555555555555",
  hostname: "nuc-1",
  controlPlaneUrl: "http://100.64.0.1:7777",
};
const workerB: WorkerRegistration = {
  id: "99999999-8888-4777-a666-555555555555",
  hostname: "nuc-2",
  controlPlaneUrl: "http://100.64.0.2:7777",
};

describe("runs queries", () => {
  let dataDir: string;
  let handle: DbHandle;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "felafel-db-runs-test-"));
    handle = createDb(dataDir);
    upsertWorker(handle.db, workerA);
    upsertWorker(handle.db, workerB);
  });

  afterEach(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("insertRun", () => {
    it("creates a pending run with a server-generated id", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      expect(run.status).toBe("pending");
      expect(run.payload).toEqual({ kind: "noop" });
      expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(run.workerId).toBeUndefined();
      expect(run.dispatchedAt).toBeUndefined();
      expect(run.completedAt).toBeUndefined();
    });

    it("round-trips arbitrary JSON payloads", () => {
      const run = insertRun(handle.db, {
        nested: { count: 3, names: ["a", "b"] },
      });
      const fetched = getRun(handle.db, run.id);
      expect(fetched?.payload).toEqual({
        nested: { count: 3, names: ["a", "b"] },
      });
    });
  });

  describe("markRunDispatched", () => {
    it("flips status, records workerId + dispatchedAt", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      const dispatched = markRunDispatched(handle.db, run.id, workerA.id);
      expect(dispatched.status).toBe("dispatched");
      expect(dispatched.workerId).toBe(workerA.id);
      expect(dispatched.dispatchedAt).toBeDefined();
    });

    it("does not overwrite a 'complete' status (PAI-110 guard)", () => {
      // Simulates the smoke-test race: the worker's complete callback
      // landed before the orchestrator's dispatch await resolved, and the
      // orchestrator then tries to mark the run dispatched. The guard
      // should refuse and leave the terminal status intact.
      const run = insertRun(handle.db, { kind: "noop" });
      markRunComplete(handle.db, run.id);
      const result = markRunDispatched(handle.db, run.id, workerA.id);
      expect(result.status).toBe("complete");
      expect(result.workerId).toBeUndefined();
      expect(result.dispatchedAt).toBeUndefined();
    });

    it("does not overwrite a 'failed' status (PAI-110 guard)", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      markRunFailed(handle.db, run.id, "boom");
      const result = markRunDispatched(handle.db, run.id, workerA.id);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("boom");
    });
  });

  describe("markRunComplete", () => {
    it("flips status to complete and sets completedAt", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      markRunDispatched(handle.db, run.id, workerA.id);
      const completed = markRunComplete(handle.db, run.id);
      expect(completed.status).toBe("complete");
      expect(completed.completedAt).toBeDefined();
      expect(completed.error).toBeUndefined();
    });

    it("preserves an optional warning error string", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      const completed = markRunComplete(handle.db, run.id, "partial-success");
      expect(completed.error).toBe("partial-success");
    });

    it("does not overwrite a 'failed' status (PAI-110 guard)", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      markRunFailed(handle.db, run.id, "boom");
      const result = markRunComplete(handle.db, run.id);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("boom");
    });

    it("is a no-op on an already-complete run", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      const first = markRunComplete(handle.db, run.id, "first");
      const second = markRunComplete(handle.db, run.id, "second");
      expect(second.status).toBe("complete");
      expect(second.error).toBe("first");
      expect(second.completedAt).toBe(first.completedAt);
    });
  });

  describe("markRunFailed", () => {
    it("flips status to failed and surfaces the error", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      const failed = markRunFailed(handle.db, run.id, "boom");
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("boom");
      expect(failed.completedAt).toBeDefined();
    });

    it("does not overwrite a 'complete' status (PAI-110 guard)", () => {
      // Mirrors the smoke-test scenario from the orchestrator's catch
      // branch: the dispatch fetch threw after the worker's complete
      // callback already landed. The guard ensures we don't lie about
      // failure when the run actually succeeded.
      const run = insertRun(handle.db, { kind: "noop" });
      markRunComplete(handle.db, run.id);
      const result = markRunFailed(handle.db, run.id, "fetch threw");
      expect(result.status).toBe("complete");
      expect(result.error).toBeUndefined();
    });

    it("allows pending → failed (dispatch error before any worker contact)", () => {
      const run = insertRun(handle.db, { kind: "noop" });
      const result = markRunFailed(handle.db, run.id, "no active worker");
      expect(result.status).toBe("failed");
      expect(result.error).toBe("no active worker");
    });
  });

  describe("listRuns", () => {
    it("returns runs newest-first by createdAt", async () => {
      const older = insertRun(handle.db, { tag: "older" });
      await sleep(SLEEP_MS);
      const newer = insertRun(handle.db, { tag: "newer" });
      const list = listRuns(handle.db);
      expect(list.map((r) => r.id)).toEqual([newer.id, older.id]);
    });

    it("returns an empty array when no runs exist", () => {
      expect(listRuns(handle.db)).toEqual([]);
    });
  });

  describe("getRun", () => {
    it("returns undefined for a missing id", () => {
      expect(getRun(handle.db, "00000000-0000-4000-8000-000000000000")).toBeUndefined();
    });
  });

  describe("markRunsTimedOutSince", () => {
    it("flips dispatched runs to failed when dispatched_at < threshold", () => {
      const run1 = insertRun(handle.db, { tag: "1" });
      const run2 = insertRun(handle.db, { tag: "2" });
      markRunDispatched(handle.db, run1.id, workerA.id);
      markRunDispatched(handle.db, run2.id, workerB.id);
      const failed = markRunsTimedOutSince(
        handle.db,
        "9999-01-01T00:00:00.000Z",
        "dispatch timeout",
      );
      expect(failed).toBe(2);
      const list = listRuns(handle.db);
      expect(list.every((r) => r.status === "failed")).toBe(true);
      expect(list.every((r) => r.error === "dispatch timeout")).toBe(true);
    });

    it("ignores pending runs (only catches dispatched)", () => {
      insertRun(handle.db, { tag: "pending" });
      const failed = markRunsTimedOutSince(
        handle.db,
        "9999-01-01T00:00:00.000Z",
        "dispatch timeout",
      );
      expect(failed).toBe(0);
    });

    it("ignores runs dispatched after the threshold", () => {
      const run = insertRun(handle.db, { tag: "fresh" });
      markRunDispatched(handle.db, run.id, workerA.id);
      const failed = markRunsTimedOutSince(
        handle.db,
        "1970-01-01T00:00:00.000Z",
        "dispatch timeout",
      );
      expect(failed).toBe(0);
    });
  });
});
