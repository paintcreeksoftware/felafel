import { createHonoApp } from "@felafel/backend";
import {
  type Db,
  deleteWorker,
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
import {
  deleteWorkerRoute,
  listWorkersRoute,
  registerWorkerRoute,
} from "@felafel/orchestrator/routes/workers";

export interface BuildAppOptions {
  db: Db;
}

export type BuildAppResult = ReturnType<typeof createHonoApp>;

/**
 * Build the orchestrator's Hono app: delegates the framework wiring
 * (cors + request-logger middleware + OTel bootstrap) to
 * `createHonoApp` from `@felafel/backend` (PAI-168 C3), then mounts
 * the orchestrator's OpenAPI routes onto the returned app. The
 * `db` is captured in each route handler's closure as before.
 * @param opts - dependency-injection options
 * @param opts.db - the Drizzle DB handle the routes will use
 * @returns the configured Hono app + the OTel SDK handle (for
 *   `sdk.shutdown()` on SIGTERM) + the parent logger.
 */
export function buildApp(opts: BuildAppOptions): BuildAppResult {
  const { app: base, sdk, logger } = createHonoApp({
    service: "felafel-orchestrator",
  });

  const app = base
    .openapi(healthRoute, (c) => c.json({ ok: true } as const))
    .openapi(listWorkersRoute, (c) => c.json(listWorkers(opts.db)))
    .openapi(registerWorkerRoute, (c) =>
      c.json(upsertWorker(opts.db, c.req.valid("json"))),
    )
    .openapi(deleteWorkerRoute, (c) => {
      const { id } = c.req.valid("param");
      const result = deleteWorker(opts.db, id);
      if (result.outcome === "missing") {
        // oxlint-disable-next-line no-magic-numbers -- 404 is the published HTTP "Not Found" status
        return c.json({ message: "no worker with that id" }, 404);
      }
      if (result.outcome === "blocked") {
        return c.json(
          {
            message: `cannot delete: ${result.referencingRunCount.toString()} run(s) reference this worker`,
            referencingRunCount: result.referencingRunCount,
          },
          // oxlint-disable-next-line no-magic-numbers -- 409 is the published HTTP "Conflict" status
          409,
        );
      }
      // oxlint-disable-next-line no-magic-numbers -- 204 is the published HTTP "No Content" status
      return c.body(null, 204);
    })
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

  return { app, sdk, logger };
}

export type AppType = BuildAppResult["app"];
