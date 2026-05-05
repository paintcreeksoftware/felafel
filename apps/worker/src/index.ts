import { hostname } from "node:os";
import { serve } from "@hono/node-server";
import { buildApp } from "@felafel/worker/app";
import {
  Defaults,
  EnvVars,
  defaultIdentityPath,
} from "@felafel/worker/constants";
import { startHeartbeat } from "@felafel/worker/heartbeat";
import { loadOrCreateIdentity } from "@felafel/worker/identity";
import { getTailnetIPv4 } from "@felafel/worker/tailscale";

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
// Bind-host resolution priority:
//   1. WORKER_HOST env var — explicit override always wins
//   2. tailscale ip -4 — auto-detect Tailnet IP so the worker
//      advertises a controlPlaneUrl the orchestrator can dial via Tailnet
//   3. Defaults.HOST (127.0.0.1) — preserves the same-machine smoke-test
//      path verbatim when no Tailscale is installed
const explicitHost = process.env[EnvVars.HOST];
const tailnetIp = explicitHost ? null : await getTailnetIPv4();
const host = explicitHost ?? tailnetIp ?? Defaults.HOST;
const identityPath =
  process.env[EnvVars.IDENTITY_PATH] ?? defaultIdentityPath();
const orchestratorUrl = process.env[EnvVars.ORCHESTRATOR_URL];
const heartbeatMs = Number(
  process.env[EnvVars.HEARTBEAT_INTERVAL_MS] ?? Defaults.HEARTBEAT_INTERVAL_MS,
);

if (!orchestratorUrl) {
  console.error(`${EnvVars.ORCHESTRATOR_URL} is required`);
  process.exit(1);
}

const id = loadOrCreateIdentity(identityPath);
const app = buildApp({ orchestratorUrl });

console.log(`worker started: id=${id} hostname=${hostname()}`);

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`worker listening on http://${info.address}:${info.port.toString()}`);
});

const controlPlaneUrl = `http://${host}:${port.toString()}`;
const stopHeartbeat = startHeartbeat({
  identity: id,
  controlPlaneUrl,
  orchestratorUrl,
  intervalMs: heartbeatMs,
});

async function shutdown(signal: string): Promise<void> {
  console.log(`received ${signal}, shutting down...`);
  stopHeartbeat();
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    process.exit(0);
  } catch (error) {
    console.error("server close error:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
