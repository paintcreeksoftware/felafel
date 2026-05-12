import { serve } from "@hono/node-server";
import { createDb } from "@felafel/db";
import { buildApp } from "@felafel/orchestrator/app";
import { Defaults, EnvVars } from "@felafel/orchestrator/constants";
import { startSweep } from "@felafel/orchestrator/sweep";

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const hostname = process.env[EnvVars.HOST] ?? Defaults.HOST;
const dataDir = process.env[EnvVars.DATA_DIR];

if (!dataDir) {
  console.error(`${EnvVars.DATA_DIR} is required`);
  process.exit(1);
}

const { db, close: closeDb } = createDb(dataDir);
const app = buildApp({ db });
const stopSweep = startSweep({ db });

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`orchestrator listening on http://${info.address}:${info.port.toString()}`);
});

/**
 *
 * @param signal
 */
function shutdown(signal: string): void {
  console.log(`received ${signal}, shutting down...`);
  stopSweep();
  closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
