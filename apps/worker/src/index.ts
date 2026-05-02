import { hostname } from "node:os";
import { serve } from "@hono/node-server";
import { buildApp } from "@felafel/worker/app";
import { Defaults, EnvVars, defaultIdentityPath } from "@felafel/worker/constants";
import { loadOrCreateIdentity } from "@felafel/worker/identity";

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const host = process.env[EnvVars.HOST] ?? Defaults.HOST;
const identityPath = process.env[EnvVars.IDENTITY_PATH] ?? defaultIdentityPath();

const id = loadOrCreateIdentity(identityPath);
const app = buildApp();

console.log(`worker started: id=${id} hostname=${hostname()}`);

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`worker listening on http://${info.address}:${info.port}`);
});
