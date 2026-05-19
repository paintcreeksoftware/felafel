// Renderer-side OTel SpanExporter that forwards finished spans to the
// Electron main process via the preload's contextBridge (PAI-178).
// Wired into the renderer's `WebTracerProvider` by `createRendererSDK`
// (packages/logs/src/browser.ts).
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-web";

import type { DesktopApi, ForwardedSpan } from "@felafel/shared";

/**
 * `window.api` declared by the preload via `contextBridge`. Tightly
 * typed against the shared `DesktopApi` so a missing `shipOtelSpan`
 * is a compile error.
 */
declare global {
  interface Window {
    api: DesktopApi;
  }
}

/**
 * Ships each finished span to main via the preload's contextBridge.
 * The renderer is context-isolated and can't reach `ipcRenderer`
 * directly; `window.api.shipOtelSpan(span)` (exposed by the preload)
 * wraps `tracedInvoke(Channels.OtelSpan, ...)` on the preload side.
 *
 * Serialization choices: `ReadableSpan` carries non-JSON-safe fields
 * (`Resource`, `InstrumentationScope`, the `spanContext()` accessor)
 * that don't survive `structuredClone` over IPC. Each span is flattened
 * to {@link ForwardedSpan} (the shared `@felafel/contracts` schema) —
 * identity, timing, kind, attributes, status, name, plus trace + span +
 * parent-span IDs so the main-side handler can seed the renderer's
 * parent context. Resource + scope are dropped on the wire; the
 * forwarder reattaches them under its own tracer identity.
 * `shutdown()` and `forceFlush()` resolve immediately — `export()`
 * ships eagerly so there's no buffer to drain.
 */
export class IpcSpanExporter implements SpanExporter {
  /**
   * Serialize each finished span and ship it via the contextBridge.
   * @param spans - finished spans to forward to main.
   * @param resultCallback - OTel SDK's completion callback.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    const sends = spans.map((span) => {
      const ctx = span.spanContext();
      const serialized: ForwardedSpan = {
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
      return window.api.shipOtelSpan(serialized);
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
