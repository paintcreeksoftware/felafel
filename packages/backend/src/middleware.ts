import { performance } from "node:perf_hooks";

import type { Logger } from "@felafel/logs";
import type { MiddlewareHandler } from "hono";

/**
 * Hono middleware that emits paired `request.start` + `request.complete`
 * log lines keyed by a shared `requestId`. The completion line carries
 * `status` + `durationMs`. The per-request child logger is stashed at
 * `c.var.logger` so route handlers inherit the bindings (PAI-168 C3).
 * @param logger - Base logger; a child is created per request.
 * @returns A Hono `MiddlewareHandler`.
 */
export function requestLoggerMiddleware(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const requestId = crypto.randomUUID();
    const child = logger.child({
      requestId,
      method: c.req.method,
      path: c.req.path,
    });
    c.set("logger", child);
    const start = performance.now();
    child.info("request.start");
    try {
      await next();
    } finally {
      const durationMs = Math.round(performance.now() - start);
      child.info(
        { status: c.res.status, durationMs },
        "request.complete",
      );
    }
  };
}
