import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { healthRoute } from "./routes/health";
import { listWorkersRoute, registerWorkerRoute } from "./routes/workers";
import type { WorkerStore } from "./store/sqlite";

export function buildApp(opts: { store: WorkerStore }) {
  // The orchestrator binds to 127.0.0.1 only (or, in container mode, behind a
  // Tailnet ACL), so the network layer already gates access. Allowing all
  // origins is what makes the Electron renderer's cross-origin fetch work in
  // dev (renderer is served by Vite at http://localhost:5173 while the
  // orchestrator listens on http://127.0.0.1:909x — different origins).
  // .use() must run before the .openapi() chain because chaining .use()
  // returns the base Hono type and loses OpenAPIHono's route narrowing.
  const base = new OpenAPIHono();
  base.use("*", cors());

  const app = base
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
