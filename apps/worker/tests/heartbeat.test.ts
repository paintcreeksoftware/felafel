import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger, Service } from "@felafel/logs";
import { startHeartbeat } from "@felafel/worker/heartbeat";
import { type WorkerRegistration } from "@felafel/shared";

const testLogger = createLogger({ service: Service.WORKER });

interface FakeOrchestrator {
  url: string;
  received: WorkerRegistration[];
  close: () => Promise<void>;
}

/**
 * Stand up a Hono fake orchestrator on an OS-assigned port that
 * captures every WorkerRegistration POST. Tests assert against
 * `received` to verify the worker's heartbeat shape.
 * @returns the live fake with received-list + close handle
 */
async function startFakeOrchestrator(): Promise<FakeOrchestrator> {
  const received: WorkerRegistration[] = [];
  const app = new Hono().post("/workers", async (c) => {
    const body = (await c.req.json()) as WorkerRegistration;
    received.push(body);
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
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * Poll `check` every 10ms until it returns true or `timeoutMs`
 * elapses. Used to wait for the worker's heartbeat loop to deliver a
 * registration without coupling tests to its internal cadence.
 * @param check - predicate evaluated each poll
 * @param timeoutMs - how long to wait before throwing
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

describe("startHeartbeat", () => {
  let fake: FakeOrchestrator;

  beforeEach(async () => {
    fake = await startFakeOrchestrator();
  });

  afterEach(async () => {
    await fake.close();
  });

  it("posts an immediate registration on boot", async () => {
    const stop = startHeartbeat({
      identity: "00000000-0000-4000-8000-000000000001",
      controlPlaneUrl: "http://127.0.0.1:9091",
      orchestratorUrl: fake.url,
      intervalMs: 60_000,
      logger: testLogger,
    });
    try {
      await waitFor(() => fake.received.length > 0, 1000);
      expect(fake.received[0]?.id).toBe("00000000-0000-4000-8000-000000000001");
      expect(fake.received[0]?.controlPlaneUrl).toBe("http://127.0.0.1:9091");
      expect(typeof fake.received[0]?.hostname).toBe("string");
    } finally {
      stop();
    }
  });

  it("posts repeatedly at the configured interval", async () => {
    const stop = startHeartbeat({
      identity: "00000000-0000-4000-8000-000000000002",
      controlPlaneUrl: "http://127.0.0.1:9091",
      orchestratorUrl: fake.url,
      intervalMs: 50,
      logger: testLogger,
    });
    try {
      await waitFor(() => fake.received.length >= 3, 1000);
    } finally {
      stop();
    }
  });

  it("stops posting after stop() is called", async () => {
    const stop = startHeartbeat({
      identity: "00000000-0000-4000-8000-000000000003",
      controlPlaneUrl: "http://127.0.0.1:9091",
      orchestratorUrl: fake.url,
      intervalMs: 50,
      logger: testLogger,
    });
    await waitFor(() => fake.received.length > 0, 1000);
    stop();
    const countAtStop = fake.received.length;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
    // Allow at most one in-flight from before stop() resolved
    expect(fake.received.length).toBeLessThanOrEqual(countAtStop + 1);
  });
});
