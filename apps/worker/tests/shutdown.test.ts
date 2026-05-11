import { Agent, createServer, request, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShutdownHandler } from "@felafel/worker/shutdown";

describe("createShutdownHandler", () => {
  let server: Server;
  let port: number;
  let agent: Agent;

  beforeEach(async () => {
    server = createServer((_req, res) => {
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    ({ port } = server.address() as AddressInfo);
    agent = new Agent({ keepAlive: true });
  });

  afterEach(() => {
    agent.destroy();
    server.closeAllConnections();
  });

  // Regression: a single idle HTTP keep-alive socket used to prevent
  // server.close() from ever invoking its callback, hanging Ctrl+C
  // indefinitely. closeIdleConnections() evicts the idle socket so
  // close() completes promptly.
  it("resolves quickly even when an idle keep-alive socket is open", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = request(
        { hostname: "127.0.0.1", port, path: "/", method: "GET", agent },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => {
            resolve();
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

    const stopHeartbeat = vi.fn();
    const shutdown = createShutdownHandler({ server, stopHeartbeat });

    const start = Date.now();
    const code = await shutdown("SIGTERM");
    const elapsed = Date.now() - start;

    expect(code).toBe(0);
    expect(stopHeartbeat).toHaveBeenCalledOnce();
    // Pre-fix this never resolved at all; any bound well under SHUTDOWN_TIMEOUT_MS catches it.
    expect(elapsed).toBeLessThan(500);
  });

  it("resolves quickly when no connections are open", async () => {
    const stopHeartbeat = vi.fn();
    const shutdown = createShutdownHandler({ server, stopHeartbeat });

    const code = await shutdown("SIGINT");

    expect(code).toBe(0);
    expect(stopHeartbeat).toHaveBeenCalledOnce();
  });

  it("returns exit code 1 when server.close reports an error", async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    const stopHeartbeat = vi.fn();
    const shutdown = createShutdownHandler({ server, stopHeartbeat });

    const code = await shutdown("SIGTERM");

    expect(code).toBe(1);
    expect(stopHeartbeat).toHaveBeenCalledOnce();
  });
});
