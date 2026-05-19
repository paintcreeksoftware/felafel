// Renderer-side OTel SpanExporter that forwards finished spans to the
// Electron main process via the `Channels.OtelSpan` IPC channel
// (PAI-178). Wired into the renderer's `WebTracerProvider` by
// `createRendererSDK` (packages/logs/src/browser.ts).
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-web";

import { Channels } from "@felafel/shared";
import { tracedInvoke } from "@felafel/shared/traced-ipc";

/** JSON-safe wire shape for a finished span. See {@link IpcSpanExporter}. */
interface SerializedSpan {
  name: string;
  kind: number;
  startTime: [number, number];
  endTime: [number, number];
  attributes: Record<string, unknown>;
  status: { code: number; message?: string };
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Ships each finished span to main over `Channels.OtelSpan`. The renderer
 * can't post OTLP directly (Electron CORS), so main's OTel SDK re-emits.
 *
 * Serialization choices: `ReadableSpan` carries non-JSON-safe fields
 * (`Resource`, `InstrumentationScope`, the `spanContext()` accessor) that
 * don't survive `structuredClone` over IPC. Each span is flattened to
 * {@link SerializedSpan} — identity, timing, kind, attributes, status,
 * name. Resource + scope are dropped on the wire; the main-side handler
 * reattaches them under the forwarder tracer's identity
 * (`felafel-desktop-renderer-forwarder`). `shutdown()` and `forceFlush()`
 * resolve immediately — `export()` invokes `tracedInvoke` per span, so
 * there's no buffer to drain.
 */
export class IpcSpanExporter implements SpanExporter {
  /**
   * Serialize each finished span and ship it over `Channels.OtelSpan`.
   * @param spans - finished spans to forward to main.
   * @param resultCallback - OTel SDK's completion callback.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    const sends = spans.map((span) => {
      const ctx = span.spanContext();
      const serialized: SerializedSpan = {
        name: span.name,
        kind: span.kind,
        startTime: span.startTime,
        endTime: span.endTime,
        attributes: { ...span.attributes },
        status: { ...span.status },
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
      };
      return tracedInvoke(Channels.OtelSpan, serialized);
    });
    Promise.all(sends)
      .then(() => { resultCallback({ code: ExportResultCode.SUCCESS }); })
      .catch((error: unknown) => {
        resultCallback({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  /**
   * No-op — `export()` ships eagerly, so there's no buffer to drain.
   * @returns Promise that resolves immediately.
   */
  shutdown(): Promise<void> { return Promise.resolve(); }

  /**
   * No-op — `export()` ships eagerly, so there's no buffer to drain.
   * @returns Promise that resolves immediately.
   */
  forceFlush(): Promise<void> { return Promise.resolve(); }
}
