import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-web";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IpcSpanExporter } from "@felafel/desktop/renderer/src/lib/ipc-span-exporter";

const shipMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

/**
 * Build a minimally-shaped {@link ReadableSpan} fixture covering only
 * the fields the exporter reads. Tests pass overrides for cases that
 * vary one field at a time.
 * @param overrides - per-test field overrides.
 * @returns the fake span.
 */
function makeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  return {
    name: "renderer-op",
    kind: 0,
    startTime: [1700000000, 0],
    endTime: [1700000001, 0],
    attributes: { "http.url": "https://x" },
    status: { code: 1 },
    spanContext: () => ({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      traceFlags: 1,
    }),
    parentSpanContext: undefined,
    ...overrides,
  } as ReadableSpan;
}

describe("IpcSpanExporter", () => {
  beforeEach(() => {
    shipMock.mockReset();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { api: { shipOtelSpan: shipMock } },
    });
  });

  it("ships each span via window.api.shipOtelSpan + invokes the callback with SUCCESS", async () => {
    shipMock.mockResolvedValue(null);
    const exporter = new IpcSpanExporter();
    const cb = vi.fn<(r: ExportResult) => void>();

    exporter.export([makeSpan(), makeSpan({ name: "second" })], cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledOnce());

    expect(shipMock).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it("invokes the callback with FAILED when shipOtelSpan rejects", async () => {
    const err = new Error("ipc boom");
    shipMock.mockRejectedValue(err);
    const exporter = new IpcSpanExporter();
    const cb = vi.fn<(r: ExportResult) => void>();

    exporter.export([makeSpan()], cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledOnce());

    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.FAILED, error: err });
  });

  it("shutdown + forceFlush resolve immediately (no buffer to drain)", async () => {
    const exporter = new IpcSpanExporter();
    await expect(exporter.shutdown()).resolves.toBeUndefined();
    await expect(exporter.forceFlush()).resolves.toBeUndefined();
  });
});
