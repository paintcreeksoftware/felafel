import { describe, expect, it } from "vitest";
import { buildApp } from "@felafel/worker/app";

describe("/health", () => {
  it("returns ok", async () => {
    const { app } = buildApp({ orchestratorUrl: "http://test-orchestrator" });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("exposes openapi.json", async () => {
    const { app } = buildApp({ orchestratorUrl: "http://test-orchestrator" });
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Felafel Worker");
  });
});
