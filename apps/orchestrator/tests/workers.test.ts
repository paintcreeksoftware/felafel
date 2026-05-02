import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { randomUUID } from "node:crypto";
import { createDb, type DbHandle } from "@felafel/db";
import { buildApp } from "@felafel/orchestrator/app";
import { type Worker, type WorkerRegistration } from "@felafel/shared";

function sampleReg(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    id: randomUUID(),
    hostname: "test-host",
    controlPlaneUrl: "http://127.0.0.1:9091",
    ...overrides,
  };
}

async function postWorker(
  app: ReturnType<typeof buildApp>,
  reg: WorkerRegistration,
): Promise<Response> {
  return await app.request("/workers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reg),
  });
}

describe("/workers", () => {
  let dataDir: string;
  let handle: DbHandle;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "orchestrator-workers-"));
    handle = createDb(dataDir);
  });

  afterEach(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("GET /workers returns empty list initially", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request("/workers");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([]);
  });

  it("POST /workers registers a worker", async () => {
    const app = buildApp({ db: handle.db });
    const reg = sampleReg();
    const res = await postWorker(app, reg);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Worker;
    expect(body.id).toBe(reg.id);
    expect(body.hostname).toBe(reg.hostname);
    expect(body.controlPlaneUrl).toBe(reg.controlPlaneUrl);
    expect(body.status).toBe("active");
    expect(typeof body.registeredAt).toBe("string");
    expect(typeof body.lastSeenAt).toBe("string");
  });

  it("POST /workers with same id upserts (no duplicate)", async () => {
    const app = buildApp({ db: handle.db });
    const id = randomUUID();
    await postWorker(app, sampleReg({ id, hostname: "first" }));
    const res = await postWorker(app, sampleReg({ id, hostname: "second" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Worker;
    expect(body.hostname).toBe("second");

    const list = (await (await app.request("/workers")).json()) as Worker[];
    expect(list).toHaveLength(1);
    expect(list[0]?.hostname).toBe("second");
  });

  it("workers persist across orchestrator restarts", async () => {
    const reg = sampleReg();
    {
      const app = buildApp({ db: handle.db });
      const res = await postWorker(app, reg);
      expect(res.status).toBe(200);
    }
    handle.close();

    const reopened = createDb(dataDir);
    try {
      const app = buildApp({ db: reopened.db });
      const list = (await (await app.request("/workers")).json()) as Worker[];
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(reg.id);
    } finally {
      reopened.close();
    }
  });

  it("POST /workers rejects invalid payload", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request("/workers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: "missing-id" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /workers rejects payload without controlPlaneUrl", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request("/workers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: randomUUID(), hostname: "no-url" }),
    });
    expect(res.status).toBe(400);
  });
});
