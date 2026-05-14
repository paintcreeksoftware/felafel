import { hostname } from "node:os";

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
  return pino(
    {
      base: {
        service: opts.service,
        node: opts.node ?? hostname(),
        pid: process.pid,
        version: opts.version ?? process.env.npm_package_version,
      },
    },
    destination,
  );
}

export { type Logger } from "pino";
