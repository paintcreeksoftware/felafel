/**
 * `@felafel/backend` — HTTP framework layer for Felafel services.
 *
 * Owns the OpenAPIHono app factory (`createHonoApp`) and the
 * request-logger middleware (`requestLoggerMiddleware`). Depends on
 * `@felafel/logs` for the logger + OTel bootstrap; consumers (HTTP
 * services like `@felafel/orchestrator` and `@felafel/worker`) get a
 * pre-wired Hono instance in one call. See PAI-168 contract C3 — the
 * canonical entry point for any HTTP service in the repo.
 *
 * `createHonoApp` + `requestLoggerMiddleware` land in subsequent
 * commits.
 */

export type { Logger } from "@felafel/logs";

export { requestLoggerMiddleware } from "@felafel/backend/middleware";

export {
  createHonoApp,
  type CreateHonoAppOptions,
} from "@felafel/backend/hono";
