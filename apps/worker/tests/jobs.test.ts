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
  /** Number of times the `/runs/:id/complete` route was hit, including failures. */
  attempts: () => number;
  close: () => Promise<void>;
}

/**
 * Stand up a Hono fake orchestrator on an OS-assigned port. By default
 * `/runs/:id/complete` succeeds on every attempt; pass `failuresBeforeSuccess`
 * to make the first N attempts return 503 so tests can exercise the
 * worker's bounded-retry behavior on transient orchestrator unavailability.
 * @param opts
 * @param opts.failuresBeforeSuccess - count of leading 503s; the (N+1)th
 *   attempt and beyond return 200. Defaults to 0 (always-success).
 * @returns the live fake with attempt count + close handle
 */
async function startFakeOrchestrator(
  opts: { failuresBeforeSuccess?: number } = {},
): Promise<FakeOrchestrator> {
  const acks: { runId: string; ack: RunComplete }[] = [];
  const failuresBudget = opts.failuresBeforeSuccess ?? 0;
  let attempts = 0;
  const app = new Hono().post("/runs/:id/complete", async (c) => {
    attempts += 1;
    if (attempts <= failuresBudget) {
      // oxlint-disable-next-line no-magic-numbers -- 503 is the published HTTP "Service Unavailable" status
      return c.json({ message: "fake outage" }, 503);
    }
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
    attempts: () => attempts,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 *
 * @param check
 * @param timeoutMs
 */
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

describe("/jobs/run completion-callback retry", () => {
  it("retries through transient 503s and eventually delivers the ack", async () => {
    // Fake fails the first 2 attempts with 503, succeeds on the 3rd.
    const flakey = await startFakeOrchestrator({ failuresBeforeSuccess: 2 });
    try {
      const runId = randomUUID();
      const app = buildApp({ orchestratorUrl: flakey.url });
      const res = await app.request("/jobs/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, payload: { hello: "world" } }),
      });
      expect(res.status).toBe(202);
      // First attempt is immediate; subsequent attempts back off at
      // 250ms / 500ms. 3 attempts total takes ~750ms; 5s upper bound is
      // generous enough to avoid flake on slow CI.
      await waitFor(() => flakey.acks.length > 0, 5000);
      expect(flakey.acks[0]?.runId).toBe(runId);
      expect(flakey.acks[0]?.ack.ok).toBe(true);
      expect(flakey.attempts()).toBe(3);
    } finally {
      await flakey.close();
    }
  }, 10_000);
});
