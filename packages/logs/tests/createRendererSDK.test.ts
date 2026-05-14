import {
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";

import { createRendererSDK } from "@felafel/logs/browser";

describe("createRendererSDK", () => {
  it("forwards spans to the provided exporter with service.name set to the requested service (C6 + C8)", async () => {
    const exported: ReadableSpan[] = [];
    const exporter: SpanExporter = {
      export(spans, callback) {
        exported.push(...spans);
        callback({ code: 0 });
      },
      shutdown: () => Promise.resolve(),
    };

    const provider = createRendererSDK({
      service: "felafel-desktop-renderer",
      exporter,
    });

    const tracer = provider.getTracer("test");
    tracer.startActiveSpan("op", (span) => {
      span.end();
    });

    await provider.forceFlush();

    expect(exported).toHaveLength(1);
    expect(exported[0]!.resource.attributes["service.name"]).toBe(
      "felafel-desktop-renderer",
    );
  });
});
