import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "pathe";
import { createDb, type DbHandle, upsertWorker } from "@felafel/db";
import { buildApp } from "@felafel/orchestrator/app";
import { type Run, type WorkerRegistration } from "@felafel/shared";
import { type FakeWorker, startFakeWorker } from "./helpers/fake-worker";

function sampleReg(
  controlPlaneUrl: string,
  overrides: Partial<WorkerRegistration> = {},
): WorkerRegistration {
  return {
    id: randomUUID(),
    hostname: "test-host",
    controlPlaneUrl,
    ...overrides,
  };
}

describe("/runs", () => {
  let dataDir: string;
  let handle: DbHandle;
  let fakeWorker: FakeWorker;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "orchestrator-runs-route-"));
    handle = createDb(dataDir);
    fakeWorker = await startFakeWorker();
  });

  afterEach(async () => {
    await fakeWorker.close();
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("POST /runs returns 503 when no workers are active", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { hello: "world" } }),
    });
    expect(res.status).toBe(503);
  });

  it("POST /runs dispatches to the active worker and returns the dispatched run", async () => {
    upsertWorker(handle.db, sampleReg(fakeWorker.url));
    const app = buildApp({ db: handle.db });
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { hello: "world" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Run;
    expect(body.status).toBe("dispatched");
    expect(body.workerId).toBeDefined();
    expect(fakeWorker.received).toHaveLength(1);
    expect(fakeWorker.received[0]?.payload).toEqual({ hello: "world" });
    expect(fakeWorker.received[0]?.runId).toBe(body.id);
  });

  it("POST /runs marks the run failed when the worker returns 5xx", async () => {
    upsertWorker(handle.db, sampleReg(fakeWorker.url));
    fakeWorker.setResponder(() =>
      Response.json({ error: "boom" }, { status: 500 }),
    );
    const app = buildApp({ db: handle.db });
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Run;
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/500/);
  });

  it("GET /runs returns runs newest-first", async () => {
    upsertWorker(handle.db, sampleReg(fakeWorker.url));
    const app = buildApp({ db: handle.db });
    const post = async (n: number): Promise<Run> => {
      const res = await app.request("/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { n } }),
      });
      return (await res.json()) as Run;
    };
    const first = await post(1);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2);
    });
    const second = await post(2);
    const list = (await (await app.request("/runs")).json()) as Run[];
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(second.id);
    expect(list[1]?.id).toBe(first.id);
  });

  it("GET /runs/:id returns the run, or 404 when missing", async () => {
    upsertWorker(handle.db, sampleReg(fakeWorker.url));
    const app = buildApp({ db: handle.db });
    const submitRes = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { x: 1 } }),
    });
    const submitted = (await submitRes.json()) as Run;

    const getRes = await app.request(`/runs/${submitted.id}`);
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as Run;
    expect(fetched.id).toBe(submitted.id);

    const missingRes = await app.request(`/runs/${randomUUID()}`);
    expect(missingRes.status).toBe(404);
  });

  it("POST /runs/:id/complete with ok:true flips status to complete", async () => {
    upsertWorker(handle.db, sampleReg(fakeWorker.url));
    const app = buildApp({ db: handle.db });
    const submitRes = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { x: 1 } }),
    });
    const submitted = (await submitRes.json()) as Run;

    const completeRes = await app.request(`/runs/${submitted.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(completeRes.status).toBe(200);
    const completed = (await completeRes.json()) as Run;
    expect(completed.status).toBe("complete");
    expect(completed.completedAt).toBeDefined();
  });

  it("POST /runs/:id/complete with ok:false flips status to failed", async () => {
    upsertWorker(handle.db, sampleReg(fakeWorker.url));
    const app = buildApp({ db: handle.db });
    const submitRes = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { x: 1 } }),
    });
    const submitted = (await submitRes.json()) as Run;

    const completeRes = await app.request(`/runs/${submitted.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "exit 1" }),
    });
    expect(completeRes.status).toBe(200);
    const completed = (await completeRes.json()) as Run;
    expect(completed.status).toBe("failed");
    expect(completed.error).toBe("exit 1");
  });

  it("POST /runs/:id/complete returns 404 for unknown run", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request(`/runs/${randomUUID()}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(res.status).toBe(404);
  });
});
