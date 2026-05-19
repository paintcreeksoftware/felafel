import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import pino, { type DestinationStream } from "pino";

import type { Service } from "@felafel/logs/service";

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

/** Options accepted by {@link createRendererSDK}. */
export interface CreateRendererSDKOptions {
  /** Top-level service identity (PAI-168 C8 contract). */
  service: Service;
  /**
   * Exporter the provider will forward finished spans to. The renderer
   * pattern (PAI-178) is an IPC-backed exporter that ships spans over
   * `Channels.OtelSpan` to the main process; `@felafel/logs` stays free
   * of electron IPC by accepting the exporter as an injected dep.
   */
  exporter: SpanExporter;
}

/**
 * Build a renderer-side OTel `WebTracerProvider` configured with the
 * service identity (matching the logger's `service` binding per C6)
 * and a simple span processor that forwards to the provided exporter.
 * Caller is responsible for `provider.register({...})`.
 * @param opts - Service identity + injected exporter.
 * @returns A configured (but unregistered) `WebTracerProvider`.
 */
export function createRendererSDK(
  opts: CreateRendererSDKOptions,
): WebTracerProvider {
  // Inline the resource here rather than reusing createTelemetryResource
  // from @felafel/logs/resource — that module imports `node:os` for
  // hostname(), which vite externalizes for the renderer bundle and the
  // build fails. The renderer has no hostname-like identity anyway;
  // service.instance.id is omitted, traces correlate via traceId.
  return new WebTracerProvider({
    resource: resourceFromAttributes({ "service.name": opts.service }),
    spanProcessors: [new SimpleSpanProcessor(opts.exporter)],
  });
}
