import { serve } from "@hono/node-server";
import { buildApp } from "@felafel/orchestrator/app";
import { Defaults, EnvVars } from "@felafel/orchestrator/constants";
import { SqliteRunStore } from "@felafel/orchestrator/store/runs";
import { SqliteWorkerStore } from "@felafel/orchestrator/store/sqlite";

const port = Number(process.env[EnvVars.PORT] ?? Defaults.PORT);
const hostname = process.env[EnvVars.HOST] ?? Defaults.HOST;
const dataDir = process.env[EnvVars.DATA_DIR];

if (!dataDir) {
  console.error(`${EnvVars.DATA_DIR} is required`);
  process.exit(1);
}

const workerStore = new SqliteWorkerStore(dataDir);
const runStore = new SqliteRunStore(dataDir);
const app = buildApp({ workerStore, runStore });

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`orchestrator listening on http://${info.address}:${info.port.toString()}`);
});
