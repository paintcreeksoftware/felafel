/**
 * `@felafel/logs` — framework-agnostic Pino + OpenTelemetry primitives.
 *
 * The package is the single source of truth for the unified log line shape
 * (service + node + pid + version + traceId/spanId bindings). See PAI-168
 * contracts C1, C2, C4, C6, C8.
 *
 * Public surface lands in subsequent commits (createLogger, bootstrap,
 * withTracedOperation, createTelemetryResource); the renderer-side
 * variants will live behind `@felafel/logs/browser`.
 */

/**
 * Top-level service identity for every Felafel process.
 *
 * The union is the load-bearing type contract — `createLogger`,
 * `bootstrap`, and `createTelemetryResource` all take this exact value,
 * so the logger's `service` binding and the OTel SDK's `service.name`
 * resource attribute cannot drift (PAI-168 C6).
 */
export type Service =
  | "felafel-orchestrator"
  | "felafel-desktop-main"
  | "felafel-desktop-renderer"
  | "felafel-worker";

/**
 * Named accessors for every member of {@link Service}. Consumers should
 * prefer `Service.DESKTOP_MAIN` etc. over the raw string literal so
 * the per-service identity flows from one place. Adding a new service
 * means adding it BOTH to the union above and to this const — the
 * `satisfies` constraint guarantees the const stays in sync (a missing
 * member is a compile error).
 */
export const Service = {
  ORCHESTRATOR: "felafel-orchestrator",
  DESKTOP_MAIN: "felafel-desktop-main",
  DESKTOP_RENDERER: "felafel-desktop-renderer",
  WORKER: "felafel-worker",
} as const satisfies Record<string, Service>;

export {
  createLogger,
  type CreateLoggerOptions,
  type Logger,
} from "@felafel/logs/logger";

export { createTelemetryResource } from "@felafel/logs/resource";

export { withTracedOperation } from "@felafel/logs/tracing";

export { bootstrap, type BootstrapOptions } from "@felafel/logs/bootstrap";
