import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "pathe";
import { SqliteRunStore } from "@felafel/orchestrator/store/runs";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("SqliteRunStore", () => {
  let dataDir: string;
  let store: SqliteRunStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "orchestrator-runs-"));
    store = new SqliteRunStore(dataDir);
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("insert creates a pending run with a server-generated id", () => {
    const run = store.insert({ hello: "world" });
    expect(run.status).toBe("pending");
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(run.payload).toEqual({ hello: "world" });
    expect(run.workerId).toBeUndefined();
    expect(run.dispatchedAt).toBeUndefined();
    expect(run.completedAt).toBeUndefined();
  });

  it("markDispatched flips status and records the worker", () => {
    const run = store.insert({ a: 1 });
    const workerId = randomUUID();
    const dispatched = store.markDispatched(run.id, workerId);
    expect(dispatched.status).toBe("dispatched");
    expect(dispatched.workerId).toBe(workerId);
    expect(dispatched.dispatchedAt).toBeDefined();
    expect(dispatched.completedAt).toBeUndefined();
  });

  it("markComplete flips status and sets completedAt", () => {
    const run = store.insert({ a: 1 });
    store.markDispatched(run.id, randomUUID());
    const complete = store.markComplete(run.id);
    expect(complete.status).toBe("complete");
    expect(complete.completedAt).toBeDefined();
    expect(complete.error).toBeUndefined();
  });

  it("markFailed flips status and surfaces the error", () => {
    const run = store.insert({ a: 1 });
    const failed = store.markFailed(run.id, "dispatch timeout");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("dispatch timeout");
    expect(failed.completedAt).toBeDefined();
  });

  it("list returns runs newest-first", async () => {
    // ISO timestamps have ms resolution; back-to-back inserts collide
    // and the order-by becomes nondeterministic. Real callers won't
    // produce three runs in the same millisecond.
    const first = store.insert({ n: 1 });
    await sleep(2);
    const second = store.insert({ n: 2 });
    await sleep(2);
    const third = store.insert({ n: 3 });
    const list = store.list();
    expect(list).toHaveLength(3);
    expect(list[0]?.id).toBe(third.id);
    expect(list[1]?.id).toBe(second.id);
    expect(list[2]?.id).toBe(first.id);
  });

  it("get returns the persisted run, or undefined when missing", () => {
    const run = store.insert({ x: true });
    expect(store.get(run.id)?.id).toBe(run.id);
    expect(store.get(randomUUID())).toBeUndefined();
  });

  it("persists across store reopens", () => {
    const run = store.insert({ persistence: "test" });
    store.close();
    const reopened = new SqliteRunStore(dataDir);
    try {
      const fetched = reopened.get(run.id);
      expect(fetched?.id).toBe(run.id);
      expect(fetched?.payload).toEqual({ persistence: "test" });
    } finally {
      reopened.close();
    }
  });
});
