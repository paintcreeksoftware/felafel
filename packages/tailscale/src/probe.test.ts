// Unit tests for `runProbe`: the retry-with-backoff + spawn-and-
// classify flow that turns a `tailscale status --json` invocation
// into a discriminated TailscaleStatus.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa, type ExecaError } from "execa";
import { runProbe } from "@felafel/tailscale/probe";

vi.mock("execa");

// p-retry's default exponential backoff would make the retry tests
// take seconds. Override the timers so retries fire synchronously.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(execa).mockReset();
});

/**
 * Stub the next execa call to resolve with the given stdout.
 * @param stdout - JSON string the fake CLI returns
 */
function stubExecaSuccess(stdout: string): void {
  vi.mocked(execa).mockResolvedValueOnce({
    stdout,
    stderr: "",
    exitCode: 0,
    isCanceled: false,
  } as unknown as Awaited<ReturnType<typeof execa>>);
}

/**
 * Stub the next execa call to reject with the given stderr + code.
 * @param stderr - stderr the fake CLI emits before failing
 * @param code - optional exit code (defaults to 1)
 */
function stubExecaFailure(stderr: string, code = 1): void {
  const err = Object.assign(new Error(stderr), {
    stdout: "",
    stderr,
    exitCode: code,
    code: "ERR",
  });
  vi.mocked(execa).mockRejectedValueOnce(err as unknown as ExecaError);
}

describe("runProbe", () => {
  it("returns kind: missing-binary when the binary path is null", async () => {
    const result = await runProbe(null);
    expect(result).toEqual({ kind: "missing-binary", path: null });
    expect(execa).not.toHaveBeenCalled();
  });

  it("returns parsed status on the happy path", async () => {
    stubExecaSuccess(
      JSON.stringify({
        BackendState: "Running",
        MagicDNSSuffix: ".tailnet-cafe.ts.net",
        Self: { HostName: "felafel-host" },
      }),
    );
    const result = await runProbe("/usr/bin/tailscale");
    expect(result).toEqual({
      kind: "connected",
      tailnet: "tailnet-cafe",
      selfName: "felafel-host",
    });
  });

  it("classifies daemon-socket EACCES failures with a remediation", async () => {
    stubExecaFailure("tailscale: permission denied on /var/run/tailscale/tailscaled.sock");
    const result = await runProbe("/usr/bin/tailscale");
    expect(result).toEqual({
      kind: "error",
      message: "Tailscale daemon socket permission denied",
      remediation: "sudo tailscale set --operator=$USER",
    });
  });

  it("classifies no-daemon stderr to a typed disconnected status", async () => {
    stubExecaFailure("failed to connect to local tailscaled daemon");
    const result = await runProbe("/usr/bin/tailscale");
    expect(result).toEqual({ kind: "disconnected", reason: "no-daemon" });
  });

  it("retries on transient EAGAIN then surfaces the eventual success", async () => {
    stubExecaFailure("EAGAIN: resource temporarily unavailable");
    stubExecaSuccess(
      JSON.stringify({
        BackendState: "Running",
        MagicDNSSuffix: ".tail.ts.net",
        Self: { HostName: "host-2" },
      }),
    );
    const promise = runProbe("/usr/bin/tailscale");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.kind).toBe("connected");
    expect(execa).toHaveBeenCalledTimes(2);
  });
});
