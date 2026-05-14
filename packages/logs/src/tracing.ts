import { performance } from "node:perf_hooks";

import { SpanStatusCode, trace } from "@opentelemetry/api";

import type { Logger } from "@felafel/logs";

const TRACER_NAME = "@felafel/logs";

/**
 * Run `fn` inside a manual OTel span named `name`, then emit a paired
 * `${name}.complete` log line with `durationMs`. The helper emits both
 * the span and the log on every exit (success or failure); consumers
 * cannot forget the paired log (PAI-168 C4). Errors are recorded on
 * the span and re-thrown.
 * @param name - Span name + completion-log prefix.
 * @param fn - Operation to run; sync or async.
 * @param logger - Logger to emit the paired completion line on.
 * @returns The resolved value of `fn`.
 */
export async function withTracedOperation<T>(
  name: string,
  fn: () => Promise<T> | T,
  logger: Logger,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    const start = performance.now();
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(error as Error);
      throw error;
    } finally {
      const durationMs = Math.round(performance.now() - start);
      span.end();
      logger.info({ durationMs }, `${name}.complete`);
    }
  });
}
