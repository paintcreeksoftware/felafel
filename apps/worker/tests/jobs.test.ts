import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { buildApp } from "@felafel/worker/app";
import { type RunComplete } from "@felafel/shared";

interface FakeOrchestrator {
  url: string;
  acks: { runId: string; ack: RunComplete }[];
  close: () => Promise<void>;
}

async function startFakeOrchestrator(): Promise<FakeOrchestrator> {
  const acks: { runId: string; ack: RunComplete }[] = [];
  const app = new Hono().post("/runs/:id/complete", async (c) => {
    const ack = (await c.req.json()) as RunComplete;
    acks.push({ runId: c.req.param("id"), ack });
    return c.json({ ok: true });
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => {
    server.once("listening", () => {
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) {
    throw new Error("fake orchestrator failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port.toString()}`,
    acks,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

async function waitFor(
  check: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error("waitFor timed out");
}

describe("/jobs/run", () => {
  let fake: FakeOrchestrator;

  beforeEach(async () => {
    fake = await startFakeOrchestrator();
  });

  afterEach(async () => {
    await fake.close();
  });

  it("accepts a valid JobAssignment with 202", async () => {
    const app = buildApp({ orchestratorUrl: fake.url });
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

  it("posts ok:true to /runs/:id/complete after handling the job", async () => {
    const runId = randomUUID();
    const app = buildApp({ orchestratorUrl: fake.url });
    const res = await app.request("/jobs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, payload: { hello: "world" } }),
    });
    expect(res.status).toBe(202);
    await waitFor(() => fake.acks.length > 0, 1000);
    expect(fake.acks[0]?.runId).toBe(runId);
    expect(fake.acks[0]?.ack.ok).toBe(true);
  });

  it("rejects payload missing runId with 400", async () => {
    const app = buildApp({ orchestratorUrl: fake.url });
    const res = await app.request("/jobs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { hello: "world" } }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects payload with non-uuid runId", async () => {
    const app = buildApp({ orchestratorUrl: fake.url });
    const res = await app.request("/jobs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "not-a-uuid", payload: {} }),
    });
    expect(res.status).toBe(400);
  });
});
