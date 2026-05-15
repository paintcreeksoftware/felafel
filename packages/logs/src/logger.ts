import { hostname } from "node:os";

import { context, trace } from "@opentelemetry/api";
import pino, { type DestinationStream, type Logger } from "pino";

import type { Service } from "@felafel/logs";

/**
 * Options accepted by {@link createLogger}.
 */
export interface CreateLoggerOptions {
  /** Top-level service identity (PAI-168 C1 contract). */
  service: Service;
  /**
   * Per-node identity (host running this process). Defaults to
   * `os.hostname()`. Distinguishes worker-1 vs worker-2 in the
   * unified log stream.
   */
  node?: string;
  /** Service version. Defaults to `process.env.npm_package_version`. */
  version?: string;
}

/**
 * Build a Pino logger pre-bound with the unified Felafel `service` +
 * `node` bindings. The only sanctioned path to construct a logger in
 * Felafel (PAI-168 C1). Additional bindings (pid, version, mixin)
 * land in subsequent commits.
 * @param opts - Service identity + optional node override.
 * @param destination - Optional pino destination; passed by tests.
 * @returns A configured `pino.Logger`.
 */
export function createLogger(
  opts: CreateLoggerOptions,
  destination?: DestinationStream,
): Logger {
  // pino-pretty runs as a worker thread; pino does a dynamic
  // `require("pino-pretty")` at construction. In bundled Electron/Node
  // entries the bundle's CJS-wrapped pino can't resolve that require,
  // so a runtime-true branch would crash the process at startup.
  //
  // The gate below depends on `process.env.NODE_ENV !== "production"`
  // being statically known at bundle time. The desktop main +
  // orchestrator sidecar bundlers (electron-vite + tsup) substitute
  // `process.env.NODE_ENV` with the literal `"production"` via
  // explicit `define`, so the entire pino-pretty branch is dead-code-
  // eliminated from production bundles. In dev mode (electron-vite
  // dev for the renderer host, `pnpm --filter @felafel/logs test`
  // for tests), `process.env.NODE_ENV` is `"development"` at runtime
  // and the transport loads normally (pino-pretty is in node_modules).
  const usePrettyTransport =
    !destination && process.env.NODE_ENV !== "production";

  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      base: {
        service: opts.service,
        node: opts.node ?? hostname(),
        pid: process.pid,
        version: opts.version ?? process.env.npm_package_version,
      },
      mixin() {
        const span = trace.getSpan(context.active());
        if (!span) {
          return {};
        }
        const ctx = span.spanContext();
        return { traceId: ctx.traceId, spanId: ctx.spanId };
      },
      ...(usePrettyTransport && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
    },
    destination,
  );
}

export { type Logger } from "pino";
