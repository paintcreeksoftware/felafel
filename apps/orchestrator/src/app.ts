import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { dispatchToWorker } from "@felafel/orchestrator/dispatch";
import { healthRoute } from "@felafel/orchestrator/routes/health";
import {
  getRunRoute,
  listRunsRoute,
  submitRunRoute,
} from "@felafel/orchestrator/routes/runs";
import { listWorkersRoute, registerWorkerRoute } from "@felafel/orchestrator/routes/workers";
import { type RunStore } from "@felafel/orchestrator/store/runs";
import { type WorkerStore } from "@felafel/orchestrator/store/sqlite";

export interface BuildAppOptions {
  workerStore: WorkerStore;
  runStore: RunStore;
}

export function buildApp(opts: BuildAppOptions) {
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
    .openapi(listWorkersRoute, (c) => c.json(opts.workerStore.list()))
    .openapi(registerWorkerRoute, (c) =>
      c.json(opts.workerStore.upsert(c.req.valid("json"))),
    )
    .openapi(submitRunRoute, async (c) => {
      const { payload } = c.req.valid("json");
      const activeWorker = opts.workerStore
        .list()
        .find((w) => w.status === "active");
      if (activeWorker === undefined) {
        // oxlint-disable-next-line no-magic-numbers -- 503 is the published HTTP "Service Unavailable" status
        return c.json({ message: "no active worker available" }, 503);
      }
      const run = opts.runStore.insert(payload);
      try {
        await dispatchToWorker(activeWorker, run.id, payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // oxlint-disable-next-line no-magic-numbers -- 200 is the published HTTP "OK" status
        return c.json(opts.runStore.markFailed(run.id, message), 200);
      }
      // oxlint-disable-next-line no-magic-numbers -- 200 is the published HTTP "OK" status
      return c.json(opts.runStore.markDispatched(run.id, activeWorker.id), 200);
    })
    .openapi(listRunsRoute, (c) => c.json(opts.runStore.list()))
    .openapi(getRunRoute, (c) => {
      const { id } = c.req.valid("param");
      const run = opts.runStore.get(id);
      if (run === undefined) {
        // oxlint-disable-next-line no-magic-numbers -- 404 is the published HTTP "Not Found" status
        return c.json({ message: "no run with that id" }, 404);
      }
      // oxlint-disable-next-line no-magic-numbers -- 200 is the published HTTP "OK" status
      return c.json(run, 200);
    });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Felafel Orchestrator", version: "0.1.0" },
  });

  return app;
}

export type AppType = ReturnType<typeof buildApp>;
