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

export { Service } from "@felafel/logs/service";

export {
  createLogger,
  type CreateLoggerOptions,
  type Logger,
} from "@felafel/logs/logger";

export { createTelemetryResource } from "@felafel/logs/resource";

export { withTracedOperation } from "@felafel/logs/tracing";

export { bootstrap, type BootstrapOptions } from "@felafel/logs/bootstrap";
