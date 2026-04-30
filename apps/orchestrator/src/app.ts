import { OpenAPIHono } from "@hono/zod-openapi";
import { healthRoute } from "./routes/health";
import { listWorkersRoute, registerWorkerRoute } from "./routes/workers";
import type { WorkerStore } from "./store/sqlite";

export function buildApp(opts: { store: WorkerStore }) {
  const app = new OpenAPIHono()
    .openapi(healthRoute, (c) => c.json({ ok: true } as const))
    .openapi(listWorkersRoute, (c) => c.json(opts.store.list()))
    .openapi(registerWorkerRoute, (c) =>
      c.json(opts.store.upsert(c.req.valid("json"))),
    );

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Felafel Orchestrator", version: "0.1.0" },
  });

  return app;
}

export type AppType = ReturnType<typeof buildApp>;
