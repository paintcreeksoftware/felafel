import { OpenAPIHono } from "@hono/zod-openapi";
import { HttpStatus } from "@felafel/worker/constants";
import { healthRoute } from "@felafel/worker/routes/health";
import { runJobRoute } from "@felafel/worker/routes/jobs";

/**
 * Build the worker's Hono app. Exposes:
 *
 * - `GET /health` — liveness probe.
 * - `POST /jobs/run` — orchestrator-dispatched jobs. Returns 202 immediately
 *   and runs the job asynchronously. v0 logs the payload; PAI-75 swaps in
 *   real execution.
 *
 * @returns an OpenAPIHono app instance ready to hand to `@hono/node-server`'s `serve()`
 */
export function buildApp() {
  const app = new OpenAPIHono()
    .openapi(healthRoute, (c) => c.json({ ok: true } as const))
    .openapi(runJobRoute, (c) => {
      const { runId, payload } = c.req.valid("json");
      // Fire-and-forget: ack the dispatch immediately and run the body of
      // the job in the next tick so the orchestrator's outbound request
      // returns fast. PAI-75 will swap the console.log for actual
      // execution against PAI-72's workstation container.
      setImmediate(() => {
        console.log("received job", runId, JSON.stringify(payload));
      });
      return c.json({ accepted: true } as const, HttpStatus.ACCEPTED);
    });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Felafel Worker", version: "0.1.0" },
  });

  return app;
}

/**
 * The fully-narrowed app type. Imported type-only by callers that need
 * `hc<WorkerAppType>` style typed clients (none today; reserved for future
 * tooling — server-to-server calls go through `packages/shared` schemas
 * with plain `fetch()`, not `hc<AppType>`).
 */
export type WorkerAppType = ReturnType<typeof buildApp>;
