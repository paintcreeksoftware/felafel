import { type Server } from "node:http";
import { hostname } from "node:os";
import { serve } from "@hono/node-server";
import { buildApp } from "@felafel/worker/app";
import { Defaults, EnvVars, defaultIdentityPath } from "@felafel/worker/constants";
import { startHeartbeat } from "@felafel/worker/heartbeat";
import { resolveHosts } from "@felafel/worker/hosts";
import { loadOrCreateIdentity } from "@felafel/worker/identity";
import { createShutdownHandler } from "@felafel/worker/shutdown";
import { getTailnetIPv4 } from "@felafel/tailscale/worker-ip";

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const explicitAdvertiseHost = process.env[EnvVars.HOST];
// Skip the tailscale spawn when WORKER_HOST is set — the autodetect would
// be discarded by resolveHosts anyway.
const tailnetIp = explicitAdvertiseHost ? null : await getTailnetIPv4();
const { advertiseHost, bindHost } = resolveHosts({
  explicitAdvertiseHost,
  explicitBindHost: process.env[EnvVars.BIND_HOST],
  tailnetIp,
});
const identityPath = process.env[EnvVars.IDENTITY_PATH] ?? defaultIdentityPath();
const orchestratorUrl = process.env[EnvVars.ORCHESTRATOR_URL];
const heartbeatMs = Number(
  process.env[EnvVars.HEARTBEAT_INTERVAL_MS] ?? Defaults.HEARTBEAT_INTERVAL_MS,
);

if (!orchestratorUrl) {
  // No logger yet — buildApp owns the bootstrap.
  process.stderr.write(`${EnvVars.ORCHESTRATOR_URL} is required\n`);
  process.exit(1);
}

const id = loadOrCreateIdentity(identityPath);
const { app, sdk, logger } = buildApp({ orchestratorUrl });

logger.info({ workerId: id, hostname: hostname() }, "startup.identity");

const server = serve({ fetch: app.fetch, port, hostname: bindHost }, (info) => {
  logger.info(
    { address: info.address, port: info.port },
    "startup.listening",
  );
});

const controlPlaneUrl = `http://${advertiseHost}:${port.toString()}`;
const stopHeartbeat = startHeartbeat({
  identity: id,
  controlPlaneUrl,
  orchestratorUrl,
  intervalMs: heartbeatMs,
  logger,
});

// `@hono/node-server`'s `serve()` returns a union (http | http2 | secure variants).
// Narrowed here because `closeIdleConnections` / `closeAllConnections` are
// http-only and we never pass a `createServer` option that would yield http2.
const shutdown = createShutdownHandler({
  server: server as Server,
  stopHeartbeat,
  sdk,
  logger,
});

/**
 * Run the worker's shutdown sequence then exit the process. The
 * separate wrapper lets process-signal handlers stay synchronous
 * while the actual shutdown is async.
 * @param signal - the POSIX signal name that triggered shutdown
 */
async function runShutdown(signal: string): Promise<void> {
  const code = await shutdown(signal);
  process.exit(code);
}

process.on("SIGTERM", () => {
  void runShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void runShutdown("SIGINT");
});
