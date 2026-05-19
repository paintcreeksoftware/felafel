/**
 * Top-level service identity for every Felafel process.
 *
 * Extracted to its own file so the renderer-safe `@felafel/logs/browser`
 * entry can re-export `Service` without pulling in `logger.ts` /
 * `resource.ts`, both of which import `node:os` and would break the
 * renderer bundle.
 *
 * The union is the load-bearing type contract — `createLogger`,
 * `bootstrap`, and `createTelemetryResource` all take this exact
 * value, so the logger's `service` binding and the OTel SDK's
 * `service.name` resource attribute cannot drift (PAI-168 C6).
 */
export type Service =
  | "felafel-orchestrator"
  | "felafel-desktop-main"
  | "felafel-desktop-renderer"
  | "felafel-worker";

/**
 * Named accessors for every member of {@link Service}. Consumers
 * should prefer `Service.DESKTOP_MAIN` etc. over the raw string
 * literal so the per-service identity flows from one place. Adding
 * a new service means adding it BOTH to the union above and to this
 * const — the `satisfies` constraint guarantees the const stays in
 * sync (a missing member is a compile error).
 */
export const Service = {
  ORCHESTRATOR: "felafel-orchestrator",
  DESKTOP_MAIN: "felafel-desktop-main",
  DESKTOP_RENDERER: "felafel-desktop-renderer",
  WORKER: "felafel-worker",
} as const satisfies Record<string, Service>;
