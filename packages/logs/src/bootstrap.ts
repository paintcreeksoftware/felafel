import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { createLogger, type Logger } from "@felafel/logs/logger";
import { createTelemetryResource } from "@felafel/logs/resource";
import type { Service } from "@felafel/logs";

/**
 * Options accepted by {@link bootstrap}.
 */
export interface BootstrapOptions {
  /** Top-level service identity (PAI-168 C2 contract). */
  service: Service;
  /**
   * Optional explicit service version; falls back to
   * `process.env.npm_package_version` for both the logger's `version`
   * binding and the OTel resource's `service.version` attribute.
   */
  version?: string;
}

/**
 * Initialize the OpenTelemetry SDK + the Felafel logger together (PAI-168
 * C2). Returns an SDK handle and a logger pre-bound with the service
 * identity. The SDK is started — and auto-instrumentations registered —
 * only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise the returned
 * `sdk` is constructed but inert (no patches applied to global APIs, no
 * spans collected). This matches the PAI-168 plan's "no-op when unset"
 * contract and keeps test suites that don't set the env var from
 * accumulating one SDK + one set of global patches per `bootstrap`
 * call.
 *
 * Single-import contract — entry points get observability in one call.
 * @param opts - Service identity.
 * @returns `{ logger, sdk }` — both already configured.
 */
export function bootstrap(opts: BootstrapOptions): {
  logger: Logger;
  sdk: NodeSDK;
} {
  const url = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const sdk = new NodeSDK({
    resource: createTelemetryResource(opts.service, opts.version),
    ...(url && { traceExporter: new OTLPTraceExporter({ url }) }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });
  if (url) {
    sdk.start();
  }
  return {
    logger: createLogger({ service: opts.service, version: opts.version }),
    sdk,
  };
}
