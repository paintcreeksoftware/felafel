import { OpenAPIHono } from "@hono/zod-openapi";
import { healthRoute } from "@felafel/worker/routes/health";

/**
 * Build the worker's Hono app. Currently exposes only `GET /health`; the
 * orchestrator-dispatched `POST /jobs/run` lands in PR4 (PAI-73_3).
 *
 * @returns an OpenAPIHono app instance ready to hand to `@hono/node-server`'s `serve()`
 */
export function buildApp() {
  const app = new OpenAPIHono().openapi(healthRoute, (c) =>
    c.json({ ok: true } as const),
  );

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
