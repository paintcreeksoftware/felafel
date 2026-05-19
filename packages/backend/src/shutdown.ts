import type { NodeSDK } from "@opentelemetry/sdk-node";

import type { Logger } from "@felafel/logs";

/**
 * Cap on awaiting `sdk.shutdown()` during graceful shutdown. The OTel
 * exporters do a best-effort flush of pending spans; a hung exporter
 * (network partition, collector down) shouldn't pin the process open
 * past this deadline. All Felafel services use the same value so a
 * stuck shutdown looks identical regardless of process.
 */
export const OTEL_FLUSH_TIMEOUT_MS = 2_000;

/**
 * Race `sdk.shutdown()` against {@link OTEL_FLUSH_TIMEOUT_MS} so a hung
 * exporter cannot pin the process open past the cap. The timer is
 * `.unref()`'d so it never keeps the event loop alive on its own.
 * Lifted from inline use in the orchestrator, the worker, and the
 * desktop main — the third site triggered the extraction per the
 * project's shutdown-helper-in-backend rule.
 * @param sdk - OTel SDK handle returned by `createHonoApp` / `bootstrap`.
 * @param logger - service-bound logger; the start line lands in the
 *   unified stream.
 */
export async function shutdownBackend(
  sdk: NodeSDK,
  logger: Logger,
): Promise<void> {
  logger.info("otel.shutdown.start");
  await Promise.race([
    sdk.shutdown(),
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, OTEL_FLUSH_TIMEOUT_MS);
      t.unref();
    }),
  ]);
}
