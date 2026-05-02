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

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const host = process.env[EnvVars.HOST] ?? Defaults.HOST;
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
