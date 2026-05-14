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
