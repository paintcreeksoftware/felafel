import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import {
  type Db,
  getRun,
  insertRun,
  listRuns,
  listWorkers,
  markRunComplete,
  markRunDispatched,
  markRunFailed,
  upsertWorker,
} from "@felafel/db";
import { dispatchToWorker } from "@felafel/orchestrator/dispatch";
import { healthRoute } from "@felafel/orchestrator/routes/health";
import {
  completeRunRoute,
  getRunRoute,
  listRunsRoute,
  submitRunRoute,
} from "@felafel/orchestrator/routes/runs";
import { listWorkersRoute, registerWorkerRoute } from "@felafel/orchestrator/routes/workers";

export interface BuildAppOptions {
  db: Db;
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
    .openapi(listWorkersRoute, (c) => c.json(listWorkers(opts.db)))
    .openapi(registerWorkerRoute, (c) =>
      c.json(upsertWorker(opts.db, c.req.valid("json"))),
    )
    .openapi(submitRunRoute, async (c) => {
      const { payload } = c.req.valid("json");
      const activeWorker = listWorkers(opts.db).find((w) => w.status === "active");
      if (activeWorker === undefined) {
        // oxlint-disable-next-line no-magic-numbers -- 503 is the published HTTP "Service Unavailable" status
        return c.json({ message: "no active worker available" }, 503);
      }
      const run = insertRun(opts.db, payload);
      // Mark dispatched BEFORE awaiting the worker fetch (PAI-110).
      // The conceptual moment of "dispatched" is when we hand the job to
      // the worker, not when the worker finishes responding. Without
      // this ordering, the worker's complete callback can land during
      // the await and set status='complete', and the post-await
      // markRunDispatched would clobber it. The status guards in the
      // db queries also protect against that, but recording the
      // timestamp at the right moment is its own correctness win.
      markRunDispatched(opts.db, run.id, activeWorker.id);
      try {
        await dispatchToWorker(activeWorker, run.id, payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // markRunFailed's guard refuses if the worker already completed
        // during the await — the returned row will then be 'complete',
        // which is the truth we want to surface.
        // oxlint-disable-next-line no-magic-numbers -- 200 is the published HTTP "OK" status
        return c.json(markRunFailed(opts.db, run.id, message), 200);
      }
      // Re-read the run after the await — the worker's complete callback
      // may have already landed and flipped status to 'complete'/'failed'.
      const fresh = getRun(opts.db, run.id);
      if (fresh === undefined) {
        throw new Error(`run ${run.id} disappeared after dispatch`);
      }
      // oxlint-disable-next-line no-magic-numbers -- 200 is the published HTTP "OK" status
      return c.json(fresh, 200);
    })
    .openapi(listRunsRoute, (c) => c.json(listRuns(opts.db)))
    .openapi(getRunRoute, (c) => {
      const { id } = c.req.valid("param");
      const run = getRun(opts.db, id);
      if (run === undefined) {
        // oxlint-disable-next-line no-magic-numbers -- 404 is the published HTTP "Not Found" status
        return c.json({ message: "no run with that id" }, 404);
      }
      // oxlint-disable-next-line no-magic-numbers -- 200 is the published HTTP "OK" status
      return c.json(run, 200);
    })
    .openapi(completeRunRoute, (c) => {
      const { id } = c.req.valid("param");
      const ack = c.req.valid("json");
      if (getRun(opts.db, id) === undefined) {
        // oxlint-disable-next-line no-magic-numbers -- 404 is the published HTTP "Not Found" status
        return c.json({ message: "no run with that id" }, 404);
      }
      const updated = ack.ok
        ? markRunComplete(opts.db, id, ack.error)
        : markRunFailed(
            opts.db,
            id,
            ack.error ?? "worker reported failure with no error string",
          );
      // oxlint-disable-next-line no-magic-numbers -- 200 is the published HTTP "OK" status
      return c.json(updated, 200);
    });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Felafel Orchestrator", version: "0.1.0" },
  });

  return app;
}

export type AppType = ReturnType<typeof buildApp>;
