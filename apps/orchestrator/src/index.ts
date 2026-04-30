import { serve } from "@hono/node-server";
import { buildApp } from "./app";

const port = Number(process.env.ORCHESTRATOR_PORT ?? "9090");
const app = buildApp();

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`orchestrator listening on http://${info.address}:${info.port}`);
});
