import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-web";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tracedInvokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@felafel/shared/traced-ipc", () => ({
  tracedInvoke: (...args: unknown[]) => tracedInvokeMock(...args),
}));

const { IpcSpanExporter } = await import(
  "@felafel/desktop/renderer/src/lib/ipc-span-exporter"
);

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
    tracedInvokeMock.mockReset();
  });

  it("ships each span via tracedInvoke + invokes the callback with SUCCESS", async () => {
    tracedInvokeMock.mockResolvedValue(null);
    const exporter = new IpcSpanExporter();
    const cb = vi.fn<(r: ExportResult) => void>();

    exporter.export([makeSpan(), makeSpan({ name: "second" })], cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledOnce());

    expect(tracedInvokeMock).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it("invokes the callback with FAILED when tracedInvoke rejects", async () => {
    const err = new Error("ipc boom");
    tracedInvokeMock.mockRejectedValue(err);
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
