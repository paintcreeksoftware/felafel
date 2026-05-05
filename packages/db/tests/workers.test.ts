// Behavioral tests for the workers query functions, run against a real
// SQLite database in a tmpdir. Mirrors the behavior pinned by the previous
// `apps/orchestrator/tests/workers.test.ts` so D6's cutover is a drop-in.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Small gap (ms) between two upserts so their ISO 8601 timestamps differ
// and ordering / preservation can be observed.
const SLEEP_MS = 5;

import { type WorkerRegistration } from "@felafel/contracts";
import { createDb, type DbHandle } from "@felafel/db";
import {
  insertRun,
  markRunDispatched,
} from "@felafel/db/queries/runs";
import {
  deleteWorker,
  listWorkers,
  markWorkersStaleSince,
  upsertWorker,
} from "@felafel/db/queries/workers";

const workerUuidA = "11111111-2222-4333-8444-555555555555";
const workerUuidB = "99999999-8888-4777-a666-555555555555";

function reg(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    id: workerUuidA,
    hostname: "nuc-1",
    controlPlaneUrl: "http://100.64.0.1:7777",
    ...overrides,
  };
}

describe("workers queries", () => {
  let dataDir: string;
  let handle: DbHandle;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "felafel-db-workers-test-"));
    handle = createDb(dataDir);
  });

  afterEach(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("listWorkers", () => {
    it("returns an empty array when no workers exist", () => {
      expect(listWorkers(handle.db)).toEqual([]);
    });

    it("returns workers ordered by registration time, newest first", async () => {
      upsertWorker(handle.db, reg({ id: workerUuidA, hostname: "older" }));
      // 5ms gap so the ISO 8601 strings are distinguishable.
      await sleep(SLEEP_MS);
      upsertWorker(handle.db, reg({ id: workerUuidB, hostname: "newer" }));

      const list = listWorkers(handle.db);
      expect(list.map((w) => w.hostname)).toEqual(["newer", "older"]);
    });

    it("round-trips optional fields including labels", () => {
      upsertWorker(
        handle.db,
        reg({
          tailscaleName: "nuc-1.tail0abcd.ts.net",
          os: "linux",
          arch: "x64",
          version: "0.1.0",
          labels: { tier: "compute", region: "lan" },
        }),
      );
      const [worker] = listWorkers(handle.db);
      expect(worker?.os).toBe("linux");
      expect(worker?.arch).toBe("x64");
      expect(worker?.labels).toEqual({ tier: "compute", region: "lan" });
    });
  });

  describe("upsertWorker", () => {
    it("inserts a new worker with status='active'", () => {
      const inserted = upsertWorker(handle.db, reg());
      expect(inserted.id).toBe(workerUuidA);
      expect(inserted.status).toBe("active");
      expect(inserted.registeredAt).toBe(inserted.lastSeenAt);
    });

    it("preserves registeredAt on re-registration but bumps lastSeenAt", async () => {
      const first = upsertWorker(handle.db, reg());
      await sleep(SLEEP_MS);
      const second = upsertWorker(handle.db, reg({ hostname: "renamed" }));

      expect(second.registeredAt).toBe(first.registeredAt);
      expect(second.lastSeenAt > first.lastSeenAt).toBe(true);
      expect(second.hostname).toBe("renamed");
    });

    it("flips status from 'stale' back to 'active' on re-registration", () => {
      upsertWorker(handle.db, reg());
      // Force the worker to stale via a sweep with a far-future threshold.
      markWorkersStaleSince(handle.db, "9999-01-01T00:00:00.000Z");
      expect(listWorkers(handle.db)[0]?.status).toBe("stale");

      upsertWorker(handle.db, reg());
      expect(listWorkers(handle.db)[0]?.status).toBe("active");
    });
  });

  describe("markWorkersStaleSince", () => {
    it("returns 0 when no workers are eligible", () => {
      upsertWorker(handle.db, reg());
      const flipped = markWorkersStaleSince(handle.db, "1970-01-01T00:00:00.000Z");
      expect(flipped).toBe(0);
    });

    it("flips active workers to 'stale' when lastSeenAt < threshold", () => {
      upsertWorker(handle.db, reg({ id: workerUuidA }));
      upsertWorker(handle.db, reg({ id: workerUuidB }));
      const flipped = markWorkersStaleSince(handle.db, "9999-01-01T00:00:00.000Z");
      expect(flipped).toBe(2);
      const list = listWorkers(handle.db);
      expect(list.every((w) => w.status === "stale")).toBe(true);
    });

    it("skips workers already in 'stale' (idempotent guard)", () => {
      upsertWorker(handle.db, reg());
      markWorkersStaleSince(handle.db, "9999-01-01T00:00:00.000Z");
      const second = markWorkersStaleSince(handle.db, "9999-01-01T00:00:00.000Z");
      expect(second).toBe(0);
    });
  });

  describe("deleteWorker", () => {
    it("hard-deletes a worker with no referencing runs", () => {
      upsertWorker(handle.db, reg());
      const result = deleteWorker(handle.db, workerUuidA);
      expect(result).toEqual({ outcome: "deleted" });
      expect(listWorkers(handle.db)).toEqual([]);
    });

    it("returns 'missing' for an id that doesn't exist", () => {
      const result = deleteWorker(handle.db, workerUuidA);
      expect(result).toEqual({ outcome: "missing" });
    });

    it("returns 'blocked' with the count when runs reference the worker", () => {
      upsertWorker(handle.db, reg());
      const run1 = insertRun(handle.db, { kind: "noop" });
      const run2 = insertRun(handle.db, { kind: "noop" });
      markRunDispatched(handle.db, run1.id, workerUuidA);
      markRunDispatched(handle.db, run2.id, workerUuidA);

      const result = deleteWorker(handle.db, workerUuidA);
      expect(result).toEqual({ outcome: "blocked", referencingRunCount: 2 });
      // Confirm the worker row was NOT deleted.
      expect(listWorkers(handle.db)).toHaveLength(1);
    });

    it("only counts runs that reference THIS worker, not other workers", () => {
      upsertWorker(handle.db, reg({ id: workerUuidA }));
      upsertWorker(
        handle.db,
        reg({ id: workerUuidB, hostname: "nuc-2", controlPlaneUrl: "http://100.64.0.2:7777" }),
      );
      const run = insertRun(handle.db, { kind: "noop" });
      markRunDispatched(handle.db, run.id, workerUuidB);

      // workerA has no referencing runs even though workerB does.
      const result = deleteWorker(handle.db, workerUuidA);
      expect(result).toEqual({ outcome: "deleted" });
      expect(listWorkers(handle.db).map((w) => w.id)).toEqual([workerUuidB]);
    });
  });
});
