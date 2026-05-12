// Tier 1 — unit tests for the pure helpers in manager.ts. Runs in
// milliseconds, no `tailscale` binary required, no spawn, no electron.
//
// The IO functions (findBinary, probeStatus, runUp) are exercised in the
// adjacent integration test file, gated on whether tailscale is installed
// on the test machine.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { TailscaleManager } from "@felafel/tailscale";

vi.mock("execa");

describe("TailscaleManager serve methods (with mocked execa)", () => {
  // FELAFEL_TAILSCALE_FAKE is a stub path so findBinary skips the `which`
  // lookup. The actual subprocess never runs — vi.mock("execa") above
  // intercepts every spawn so each test can pre-stage the canned output.
  const stubBinary = "/usr/bin/fake-tailscale";
  let manager: TailscaleManager;

  beforeEach(() => {
    process.env.FELAFEL_TAILSCALE_FAKE = stubBinary;
    manager = new TailscaleManager();
    vi.mocked(execa).mockReset();
  });

  afterEach(() => {
    delete process.env.FELAFEL_TAILSCALE_FAKE;
  });

  /**
   * Stub a single execa call. Returns the success/failure shape the
   * production code consumes via `result.stdout`, `result.exitCode`,
   * `result.isCanceled`. Cast through `unknown` because execa's full
   * `Result` type has dozens of fields the test doesn't care about.
   * @param opts
   * @param opts.stdout
   * @param opts.stderr
   * @param opts.exitCode
   */
  function stubExeca(opts: { stdout?: string; stderr?: string; exitCode?: number }): void {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: opts.stdout ?? "",
      stderr: opts.stderr ?? "",
      exitCode: opts.exitCode ?? 0,
      isCanceled: false,
    } as unknown as Awaited<ReturnType<typeof execa>>);
  }

  it("publishServe shells out with --tcp + tcp://127.0.0.1:<local>", async () => {
    stubExeca({});
    await manager.publishServe({ tailnetPort: 9090, localPort: 54321 });
    expect(execa).toHaveBeenCalledWith(
      stubBinary,
      ["serve", "--bg", "--tcp=9090", "tcp://127.0.0.1:54321"],
      expect.any(Object),
    );
  });

  it("unpublishServe shells out with --tcp + 'off'", async () => {
    stubExeca({});
    await manager.unpublishServe({ tailnetPort: 9090 });
    expect(execa).toHaveBeenCalledWith(
      stubBinary,
      ["serve", "--tcp=9090", "off"],
      expect.any(Object),
    );
  });

  it("readServePublished returns the local port when serve status reports a TCP forward", async () => {
    stubExeca({
      stdout: JSON.stringify({ TCP: { "9090": { TCPForward: "127.0.0.1:54321" } } }),
    });
    const result = await manager.readServePublished({ tailnetPort: 9090 });
    expect(result).toEqual({ targetLocalPort: 54321 });
  });

  it("readServePublished returns null when serve status reports nothing on the port", async () => {
    stubExeca({ stdout: JSON.stringify({}) });
    expect(await manager.readServePublished({ tailnetPort: 9090 })).toBeNull();
  });

  it("readServePublished returns null when stdout is empty", async () => {
    stubExeca({ stdout: "" });
    expect(await manager.readServePublished({ tailnetPort: 9090 })).toBeNull();
  });

  it("publishServe surfaces a classified error when the CLI fails", async () => {
    stubExeca({
      stderr: "tailscale: permission denied on /var/run/tailscale/tailscaled.sock",
      exitCode: 1,
    });
    await expect(
      manager.publishServe({ tailnetPort: 9090, localPort: 54321 }),
    ).rejects.toThrow(/eacces/u);
  });

  it("publish → read → unpublish round-trips the requested mapping", async () => {
    // 1. publish
    stubExeca({});
    await manager.publishServe({ tailnetPort: 9090, localPort: 54321 });

    // 2. read sees what we just published
    stubExeca({
      stdout: JSON.stringify({ TCP: { "9090": { TCPForward: "127.0.0.1:54321" } } }),
    });
    expect(await manager.readServePublished({ tailnetPort: 9090 })).toEqual({
      targetLocalPort: 54321,
    });

    // 3. unpublish
    stubExeca({});
    await manager.unpublishServe({ tailnetPort: 9090 });

    // 4. read no longer sees a mapping
    stubExeca({ stdout: JSON.stringify({}) });
    expect(await manager.readServePublished({ tailnetPort: 9090 })).toBeNull();

    expect(vi.mocked(execa)).toHaveBeenCalledTimes(4);
  });
});
