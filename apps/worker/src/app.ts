import pRetry from "p-retry";
import { createHonoApp } from "@felafel/backend";
import { Service } from "@felafel/logs";
import { type RunComplete } from "@felafel/shared";
import { CompleteCallbackRetry } from "@felafel/worker/constants";
import { healthRoute } from "@felafel/worker/routes/health";
import { runJobRoute } from "@felafel/worker/routes/jobs";

/**
 * Configuration accepted by {@link buildApp}.
 */
export interface BuildAppOptions {
  /**
   * Orchestrator base URL. The worker uses it to POST the synthetic
   * completion ack after running a job. Same URL the heartbeat loop
   * already targets — passed in explicitly so this module stays
   * env-var-free for testability.
   */
  orchestratorUrl: string;
}

/**
 * Build the worker's Hono app. Exposes:
 *
 * - `GET /health` — liveness probe.
 * - `POST /jobs/run` — orchestrator-dispatched jobs. Returns 202 immediately
 *   and runs the job asynchronously, then POSTs `RunComplete { ok: true }`
 *   to the orchestrator's `/runs/:id/complete`. v0 logs the payload; PAI-75
 *   swaps in real execution and may post `ok: false` on process failure.
 * @param opts - app configuration; see {@link BuildAppOptions}
 * @returns `{ app, sdk, logger }` — the route-narrowed app + the OTel
 *   SDK handle (for `sdk.shutdown()` on SIGTERM) + the parent logger
 *   (for the entry point and the non-HTTP modules: heartbeat, shutdown).
 */
export function buildApp(opts: BuildAppOptions) {
  const { app: base, sdk, logger } = createHonoApp({
    service: Service.WORKER,
  });

  const app = base
    .openapi(healthRoute, (c) => c.json({ ok: true } as const))
    .openapi(runJobRoute, (c) => {
      const { runId, payload } = c.req.valid("json");
      // Fire-and-forget: ack the dispatch immediately and run the body of
      // the job in the next tick so the orchestrator's outbound request
      // returns fast. PAI-75 will swap the log line for actual execution
      // against PAI-72's workstation container.
      // Wrap async body in a void IIFE — setImmediate's callback type
      // is void-returning, so handing it an async function is a
      // misused-promise. The detached body still does its work; we
      // explicitly mark the floating promise as intentional.
      setImmediate(() => {
        void (async () => {
        logger.info({ runId, payload }, "job.received");
        const ack: RunComplete = { ok: true };
        try {
          await pRetry(
            async () => {
              const res = await fetch(
                `${opts.orchestratorUrl}/runs/${runId}/complete`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(ack),
                },
              );
              if (!res.ok) {
                throw new Error(
                  `POST /runs/${runId}/complete returned ${res.status.toString()}`,
                );
              }
            },
            {
              retries: CompleteCallbackRetry.MAX_ATTEMPTS - 1,
              factor: 2,
              minTimeout: CompleteCallbackRetry.INITIAL_DELAY_MS,
              maxTimeout: CompleteCallbackRetry.MAX_DELAY_MS,
            },
          );
        } catch (error) {
          // After exhausting retries the orchestrator's 5-minute sweep will
          // flip this run to `failed` with `error: 'dispatch timeout'`. The
          // structured runId binding lets the operator correlate the
          // orchestrator-side symptom back to the worker's callback failure.
          logger.error(
            { runId, err: error },
            "job.complete.callback-exhausted",
          );
        }
        })();
      });
      // oxlint-disable-next-line no-magic-numbers -- 202 is the published HTTP "Accepted" status
      return c.json({ accepted: true } as const, 202);
    });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Felafel Worker", version: "0.1.0" },
  });

  return { app, sdk, logger };
}

/**
 * The fully-narrowed app type. Imported type-only by callers that need
 * `hc<WorkerAppType>` style typed clients (none today; reserved for future
 * tooling — server-to-server calls go through `packages/shared` schemas
 * with plain `fetch()`, not `hc<AppType>`).
 */
export type WorkerAppType = ReturnType<typeof buildApp>["app"];
