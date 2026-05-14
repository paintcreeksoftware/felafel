import pino, { type DestinationStream, type Logger } from "pino";

import type { Service } from "@felafel/logs";

/**
 * Options accepted by {@link createLogger}.
 */
export interface CreateLoggerOptions {
  /** Top-level service identity (PAI-168 C1 contract). */
  service: Service;
}

/**
 * Build a Pino logger pre-bound with the unified Felafel `service`
 * binding. The only sanctioned path to construct a logger in Felafel
 * (PAI-168 C1). Additional bindings (node, pid, version, mixin) land
 * in subsequent commits.
 * @param opts - Service identity.
 * @param destination - Optional pino destination; passed by tests.
 * @returns A configured `pino.Logger`.
 */
export function createLogger(
  opts: CreateLoggerOptions,
  destination?: DestinationStream,
): Logger {
  return pino({ base: { service: opts.service } }, destination);
}

export { type Logger } from "pino";
