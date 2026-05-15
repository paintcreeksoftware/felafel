import { cors } from "hono/cors";
import { OpenAPIHono } from "@hono/zod-openapi";

import { bootstrap, type Logger, type Service } from "@felafel/logs";
import type { NodeSDK } from "@opentelemetry/sdk-node";

import { requestLoggerMiddleware } from "@felafel/backend/middleware";

/** Options accepted by {@link createHonoApp}. */
export interface CreateHonoAppOptions {
  /** Top-level service identity (PAI-168 C3 contract). */
  service: Service;
  /** Service version. */
  version?: string;
}

/**
 * Build a Hono OpenAPIHono app pre-wired with `cors()` +
 * `requestLoggerMiddleware`. Calls `bootstrap` from `@felafel/logs`
 * internally so OTel + the logger are initialized atomically. The
 * canonical entry point for any HTTP service in the repo (PAI-168 C3).
 *
 * Consumers hold the returned `sdk` to call `sdk.shutdown()` on
 * SIGTERM / SIGINT, and the returned `logger` for startup/shutdown
 * log lines and for passing to non-HTTP subsystems (sweep loops,
 * background workers) that need the same `service`-bound logger
 * the request-logger middleware uses for per-request children.
 * @param opts - Service identity + optional version.
 * @returns `{ app, sdk, logger }` — pre-wired Hono app, the OTel
 *   SDK handle, and the parent logger.
 */
export function createHonoApp(opts: CreateHonoAppOptions): {
  app: OpenAPIHono;
  sdk: NodeSDK;
  logger: Logger;
} {
  const { logger, sdk } = bootstrap({
    service: opts.service,
    version: opts.version,
  });
  const app = new OpenAPIHono();
  app.use("*", cors());
  app.use("*", requestLoggerMiddleware(logger));
  return { app, sdk, logger };
}
