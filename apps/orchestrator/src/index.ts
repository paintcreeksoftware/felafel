import { serve } from "@hono/node-server";
import { buildApp } from "./app";
import { SqliteWorkerStore } from "./store/sqlite";

const port = Number(process.env.ORCHESTRATOR_PORT ?? "9090");
const dataDir = process.env.ORCHESTRATOR_DATA_DIR;

if (!dataDir) {
  console.error("ORCHESTRATOR_DATA_DIR is required");
  process.exit(1);
}

const store = new SqliteWorkerStore(dataDir);
const app = buildApp({ store });

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`orchestrator listening on http://${info.address}:${info.port}`);
});
