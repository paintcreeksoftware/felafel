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
  // pino-pretty runs as a worker thread, which means pino does a
  // dynamic `require("pino-pretty")` at construction time. In bundled
  // Electron/Node entries (desktop main, orchestrator sidecar) the
  // bundle's CJS-wrapped pino can't resolve that require, and the
  // whole process crashes at startup. Default the transport OFF and
  // require an explicit `FELAFEL_LOG_PRETTY=1` opt-in for the dev-mode
  // colored output. The structured JSON (pino's default destination —
  // stderr) is what every consumer actually needs.
  const usePrettyTransport =
    !destination && process.env.FELAFEL_LOG_PRETTY === "1";

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
