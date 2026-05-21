// Unit tests for `runUpFlow` + `makeUpFlowCache` + the indirectly-tested
// `supportsAuthkeyStdin` probe cache. Stubs execa at the spawn boundary
// and lets the real `classifyUpError` decide outcomes — same pattern as
// `serve.test.ts`, so the tests double as coverage for the up-side
// classifier path through the production helper.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { createLogger, Service } from "@felafel/logs";
import { makeUpFlowCache, runUpFlow } from "@felafel/tailscale/up";

const testLogger = createLogger({ service: Service.DESKTOP_MAIN });

vi.mock("execa");

const stubBinary = "/usr/bin/fake-tailscale";

beforeEach(() => {
  vi.mocked(execa).mockReset();
});

afterEach(() => {
  vi.mocked(execa).mockReset();
});

/**
 * Queue one execa response. Default shape mirrors a clean exit with no
 * output — tests override only the fields they care about.
 * @param overrides - per-call result fields
 * @param overrides.stdout - stdout the stub returns (default empty)
 * @param overrides.stderr - stderr the stub returns (default empty)
 * @param overrides.exitCode - exit code the stub returns (default 0)
 * @param overrides.isCanceled - whether the stub reports cancellation (default false)
 */
function stubExeca(overrides: {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  isCanceled?: boolean;
}): void {
  vi.mocked(execa).mockResolvedValueOnce({
    stdout: overrides.stdout ?? "",
    stderr: overrides.stderr ?? "",
    exitCode: overrides.exitCode ?? 0,
    isCanceled: overrides.isCanceled ?? false,
  } as unknown as Awaited<ReturnType<typeof execa>>);
}

describe("makeUpFlowCache", () => {
  it("returns a fresh cache with no in-flight probe", () => {
    expect(makeUpFlowCache()).toEqual({ stdinSupportPromise: undefined });
  });

  it("returns independent cache objects per call", () => {
    const a = makeUpFlowCache();
    const b = makeUpFlowCache();
    expect(a).not.toBe(b);
  });
});

describe("runUpFlow — no authkey (session-resume path)", () => {
  it("spawns `tailscale up --timeout=5s` and returns connected on exit 0", async () => {
    stubExeca({});
    const result = await runUpFlow(stubBinary, undefined, makeUpFlowCache(), testLogger);
    expect(result).toEqual({ ok: true, kind: "connected" });
    expect(execa).toHaveBeenCalledWith(
      stubBinary,
      ["up", "--timeout=5s"],
      expect.objectContaining({ reject: false }),
    );
  });

  it("does not probe --authkey-stdin support when there's no key", async () => {
    stubExeca({});
    await runUpFlow(stubBinary, undefined, makeUpFlowCache(), testLogger);
    expect(execa).toHaveBeenCalledTimes(1);
  });
});

describe("runUpFlow — keyed (paste-in) path", () => {
  it("pipes the key on stdin and uses `--authkey-stdin` when the CLI supports it", async () => {
    // First execa call = `tailscale up --help`, stdout mentions --authkey-stdin.
    stubExeca({ stdout: "  --authkey-stdin    Read auth key from stdin" });
    // Second execa call = the actual `tailscale up` with --authkey-stdin.
    stubExeca({});
    const result = await runUpFlow(stubBinary, "tskey-auth-xxx", makeUpFlowCache(), testLogger);
    expect(result).toEqual({ ok: true, kind: "connected" });
    expect(execa).toHaveBeenNthCalledWith(1, stubBinary, ["up", "--help"]);
    expect(execa).toHaveBeenNthCalledWith(
      2,
      stubBinary,
      ["up", "--timeout=30s", "--authkey-stdin"],
      expect.objectContaining({ input: "tskey-auth-xxx", reject: false }),
    );
  });

  it("falls back to --authkey=KEY and warns when the CLI lacks --authkey-stdin", async () => {
    const warn = vi.spyOn(testLogger, "warn");
    stubExeca({ stdout: "  --authkey    Pre-auth key" });
    stubExeca({});
    const result = await runUpFlow(stubBinary, "tskey-auth-xxx", makeUpFlowCache(), testLogger);
    expect(result).toEqual({ ok: true, kind: "connected" });
    expect(execa).toHaveBeenNthCalledWith(
      2,
      stubBinary,
      ["up", "--timeout=30s", "--authkey=tskey-auth-xxx"],
      expect.objectContaining({ reject: false }),
    );
    expect(warn).toHaveBeenCalledWith("tailscale.up.authkey.stdin-unsupported");
    warn.mockRestore();
  });

  it("treats a failed help probe as 'no stdin support' (falls back to --authkey=KEY)", async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error("ENOENT: tailscale not executable"));
    stubExeca({});
    const result = await runUpFlow(stubBinary, "tskey-auth-xxx", makeUpFlowCache(), testLogger);
    expect(result).toEqual({ ok: true, kind: "connected" });
  });

  it("caches the --authkey-stdin probe so a second call reuses the result", async () => {
    const cache = makeUpFlowCache();
    stubExeca({ stdout: "  --authkey-stdin" });
    stubExeca({});
    await runUpFlow(stubBinary, "tskey-1", cache, testLogger);
    expect(execa).toHaveBeenCalledTimes(2);
    // Cache hit: only one execa (the real up), no second help probe.
    stubExeca({});
    await runUpFlow(stubBinary, "tskey-2", cache, testLogger);
    expect(execa).toHaveBeenCalledTimes(3);
    expect(execa).toHaveBeenLastCalledWith(
      stubBinary,
      ["up", "--timeout=30s", "--authkey-stdin"],
      expect.objectContaining({ input: "tskey-2" }),
    );
  });
});
