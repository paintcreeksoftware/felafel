import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { createDb, type DbHandle } from "@felafel/db";
import { buildApp } from "@felafel/orchestrator/app";

describe("GET /health", () => {
  let dataDir: string;
  let handle: DbHandle;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "orchestrator-health-"));
    handle = createDb(dataDir);
  });

  afterEach(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns ok: true", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("publishes an OpenAPI spec at /openapi.json", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths).toHaveProperty("/health");
    expect(spec.paths).toHaveProperty("/workers");
  });

  it("answers CORS preflight for cross-origin renderer fetches", async () => {
    const app = buildApp({ db: handle.db });
    const res = await app.request("/workers", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
