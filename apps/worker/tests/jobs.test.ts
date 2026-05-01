import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "@felafel/worker/app";

describe("/jobs/run", () => {
  it("accepts a valid JobAssignment with 202", async () => {
    const app = buildApp();
    const res = await app.request("/jobs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: randomUUID(),
        payload: { hello: "world" },
      }),
    });
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ accepted: true });
  });

  it("rejects payload missing runId with 400", async () => {
    const app = buildApp();
    const res = await app.request("/jobs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { hello: "world" } }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects payload with non-uuid runId", async () => {
    const app = buildApp();
    const res = await app.request("/jobs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "not-a-uuid", payload: {} }),
    });
    expect(res.status).toBe(400);
  });
});
