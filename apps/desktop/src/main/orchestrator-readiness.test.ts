// Unit tests for waitForOrchestratorReady — the /health poller with
// exponential backoff between attempts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForOrchestratorReady } from "@felafel/desktop/main/orchestrator-readiness";

describe("waitForOrchestratorReady", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the first probe returns ok", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await expect(waitForOrchestratorReady("http://127.0.0.1:9090")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:9090/health");
  });

  it("retries until a probe returns ok", async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const promise = waitForOrchestratorReady("http://127.0.0.1:9090");
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("rejects after exhausting the retry budget when /health stays non-ok", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503 } as Response);
    const promise = waitForOrchestratorReady("http://127.0.0.1:9090");
    const assertion = expect(promise).rejects.toThrow(/503/u);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("rejects when fetch itself throws (e.g. connection refused) beyond the budget", async () => {
    fetchSpy.mockRejectedValue(new Error("connection refused"));
    const promise = waitForOrchestratorReady("http://127.0.0.1:9090");
    const assertion = expect(promise).rejects.toThrow("connection refused");
    await vi.runAllTimersAsync();
    await assertion;
  });
});
