import pino, { type DestinationStream } from "pino";

import type { Service } from "@felafel/logs";

/** Options accepted by the browser-entry {@link createLogger}. */
export interface CreateBrowserLoggerOptions {
  /** Top-level service identity (PAI-168 C1 contract). */
  service: Service;
  /** Per-renderer identity. Defaults to `"renderer"`. */
  node?: string;
  /** Service version. */
  version?: string;
  /** Pino log level. Defaults to `"info"`. */
  level?: string;
}

/**
 * Build a Pino logger for the renderer pre-bound with the unified
 * Felafel log shape. Vite resolves `pino` to `pino/browser` when
 * bundling the renderer, so records land in DevTools via console.*
 * as structured objects. No OTel mixin — renderer tracing goes
 * through createRendererSDK (C11). PAI-182 tracks log file forwarding.
 * @param opts - Service identity + optional node / version / level.
 * @param destination - Optional pino destination (tests only).
 * @returns A configured `pino.Logger`.
 */
export function createLogger(
  opts: CreateBrowserLoggerOptions,
  destination?: DestinationStream,
): pino.Logger {
  return pino(
    {
      level: opts.level ?? "info",
      base: {
        service: opts.service,
        node: opts.node ?? "renderer",
        version: opts.version,
      },
      browser: { asObject: true },
    },
    destination,
  );
}

export { type Logger } from "pino";
