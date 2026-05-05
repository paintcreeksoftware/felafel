// Tier 1 — unit tests for the pure helpers in tailscale.ts. Runs in
// milliseconds, no `tailscale` binary required, no spawn, no electron.
//
// The IO functions (findBinary, probeStatus, runUp) are exercised in the
// adjacent integration test file, gated on whether tailscale is installed
// on the test machine.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import {
  TailscaleManager,
  classifyServeError,
  classifyUpError,
  parseServeConfigJson,
  parseStatusJson,
} from "@felafel/desktop/main/tailscale";

vi.mock("execa");

describe("parseStatusJson", () => {
  it("returns connected with tailnet and selfName for BackendState=Running", () => {
    const stdout = JSON.stringify({
      BackendState: "Running",
      MagicDNSSuffix: "tail-scales-abc.ts.net",
      Self: { HostName: "felafel-laptop", Online: true },
    });
    expect(parseStatusJson(stdout)).toEqual({
      kind: "connected",
      tailnet: "tail-scales-abc",
      selfName: "felafel-laptop",
    });
  });

  it("strips a leading dot from MagicDNSSuffix", () => {
    const stdout = JSON.stringify({
      BackendState: "Running",
      MagicDNSSuffix: ".example.ts.net",
      Self: { HostName: "host", Online: true },
    });
    expect(parseStatusJson(stdout)).toMatchObject({ tailnet: "example" });
  });

  it("falls back to 'tailnet' when MagicDNSSuffix is empty", () => {
    const stdout = JSON.stringify({
      BackendState: "Running",
      MagicDNSSuffix: "",
      Self: { HostName: "host", Online: true },
    });
    expect(parseStatusJson(stdout)).toMatchObject({ tailnet: "tailnet" });
  });

  it("falls back to 'this machine' when Self.HostName is missing", () => {
    const stdout = JSON.stringify({
      BackendState: "Running",
      MagicDNSSuffix: "x.ts.net",
      Self: {},
    });
    expect(parseStatusJson(stdout)).toMatchObject({ selfName: "this machine" });
  });

  it("returns disconnected with reason needs-login for NeedsLogin", () => {
    expect(parseStatusJson(JSON.stringify({ BackendState: "NeedsLogin" }))).toEqual({
      kind: "disconnected",
      reason: "needs-login",
    });
  });

  it("returns disconnected with reason stopped for Stopped", () => {
    expect(parseStatusJson(JSON.stringify({ BackendState: "Stopped" }))).toEqual({
      kind: "disconnected",
      reason: "stopped",
    });
  });

  it("returns probing for transient backend states (NoState, Starting)", () => {
    expect(parseStatusJson(JSON.stringify({ BackendState: "NoState" }))).toEqual({ kind: "probing" });
    expect(parseStatusJson(JSON.stringify({ BackendState: "Starting" }))).toEqual({
      kind: "probing",
    });
  });

  it("returns error for unrecognized BackendState", () => {
    expect(parseStatusJson(JSON.stringify({ BackendState: "Invented" }))).toMatchObject({
      kind: "error",
    });
  });

  it("returns error for malformed JSON", () => {
    expect(parseStatusJson("not json {{{")).toMatchObject({ kind: "error" });
  });

  it("returns error for non-object JSON (array, string, null)", () => {
    expect(parseStatusJson("[]")).toMatchObject({ kind: "error" });
    expect(parseStatusJson('"a string"')).toMatchObject({ kind: "error" });
    expect(parseStatusJson("null")).toMatchObject({ kind: "error" });
  });
});

describe("classifyUpError", () => {
  it("returns timeout when timedOut=true regardless of stderr content", () => {
    expect(classifyUpError("permission denied", 1, true)).toMatchObject({ kind: "timeout" });
  });

  it("classifies 'permission denied' stderr as eacces", () => {
    expect(
      classifyUpError(
        "tailscale: failed to connect: permission denied on /var/run/tailscale/tailscaled.sock",
        1,
        false,
      ),
    ).toMatchObject({ kind: "eacces" });
  });

  it("classifies bare EACCES as eacces", () => {
    expect(classifyUpError("EACCES while opening socket", 1, false)).toMatchObject({
      kind: "eacces",
    });
  });

  it("classifies tailscaled.sock connect failures as no-daemon", () => {
    expect(
      classifyUpError("dial unix /var/run/tailscale/tailscaled.sock: no such file", 1, false),
    ).toMatchObject({ kind: "no-daemon" });
  });

  it("captures the auth URL and classifies as needs-login", () => {
    const stderr =
      "To authenticate, visit:\n\n  https://login.tailscale.com/a/abc123def456\n\n";
    const result = classifyUpError(stderr, 1, false);
    expect(result).toMatchObject({
      kind: "needs-login",
      authUrl: "https://login.tailscale.com/a/abc123def456",
    });
  });

  it("classifies invalid auth key stderr as invalid-key", () => {
    expect(classifyUpError("invalid auth key: rejected by control", 1, false)).toMatchObject({
      kind: "invalid-key",
    });
    expect(classifyUpError("unauthorized: key has been revoked", 1, false)).toMatchObject({
      kind: "invalid-key",
    });
  });

  it("falls through to unknown for unmatched stderr", () => {
    expect(classifyUpError("something completely unexpected", 7, false)).toMatchObject({
      kind: "unknown",
    });
  });

  it("EACCES wins over auth-url when both appear", () => {
    const stderr =
      "permission denied; would visit https://login.tailscale.com/a/abc but cannot";
    expect(classifyUpError(stderr, 1, false)).toMatchObject({ kind: "eacces" });
  });
});

describe("parseServeConfigJson", () => {
  it("returns the local port when a TCPForward exists for the requested tailnet port", () => {
    const stdout = JSON.stringify({
      TCP: { "9090": { TCPForward: "127.0.0.1:54321" } },
    });
    expect(parseServeConfigJson(stdout, 9090)).toEqual({ targetLocalPort: 54321 });
  });

  it("returns null when no entry exists for the requested port", () => {
    const stdout = JSON.stringify({
      TCP: { "8080": { TCPForward: "127.0.0.1:11111" } },
    });
    expect(parseServeConfigJson(stdout, 9090)).toBeNull();
  });

  it("returns null when the TCP table is absent entirely", () => {
    expect(parseServeConfigJson(JSON.stringify({ Web: {} }), 9090)).toBeNull();
  });

  it("returns null when TCPForward is missing on the entry", () => {
    const stdout = JSON.stringify({
      TCP: { "9090": { HTTPS: true } },
    });
    expect(parseServeConfigJson(stdout, 9090)).toBeNull();
  });

  it("parses an IPv6 TCPForward target by splitting on the last colon", () => {
    const stdout = JSON.stringify({
      TCP: { "9090": { TCPForward: "[::1]:60123" } },
    });
    expect(parseServeConfigJson(stdout, 9090)).toEqual({ targetLocalPort: 60123 });
  });

  it("returns null for malformed JSON", () => {
    expect(parseServeConfigJson("not json {{{", 9090)).toBeNull();
  });

  it("returns null when TCPForward is missing a port (no colon)", () => {
    const stdout = JSON.stringify({
      TCP: { "9090": { TCPForward: "127.0.0.1" } },
    });
    expect(parseServeConfigJson(stdout, 9090)).toBeNull();
  });

  it("returns null when the parsed port is out of range", () => {
    const stdout = JSON.stringify({
      TCP: { "9090": { TCPForward: "127.0.0.1:99999" } },
    });
    expect(parseServeConfigJson(stdout, 9090)).toBeNull();
  });

  it("returns null when stdout is empty", () => {
    expect(parseServeConfigJson("", 9090)).toBeNull();
  });
});

describe("classifyServeError", () => {
  it("returns timeout when timedOut=true regardless of stderr content", () => {
    expect(classifyServeError("permission denied", 1, true)).toMatchObject({ kind: "timeout" });
  });

  it("classifies 'permission denied' stderr as eacces", () => {
    expect(
      classifyServeError(
        "tailscale: permission denied on /var/run/tailscale/tailscaled.sock",
        1,
        false,
      ),
    ).toMatchObject({ kind: "eacces" });
  });

  it("classifies tailscaled.sock connect failures as no-daemon", () => {
    expect(
      classifyServeError("dial unix /var/run/tailscale/tailscaled.sock: no such file", 1, false),
    ).toMatchObject({ kind: "no-daemon" });
  });

  it("classifies 'address already in use' as port-in-use", () => {
    expect(classifyServeError("listen tcp :9090: address already in use", 1, false)).toMatchObject({
      kind: "port-in-use",
    });
  });

  it("classifies 'already serving on port' as port-in-use", () => {
    expect(classifyServeError("port 9090 already serving", 1, false)).toMatchObject({
      kind: "port-in-use",
    });
  });

  it("falls through to unknown for unmatched stderr", () => {
    expect(classifyServeError("something completely unexpected", 7, false)).toMatchObject({
      kind: "unknown",
    });
  });

  it("EACCES wins over port-in-use when both phrases appear", () => {
    expect(
      classifyServeError("permission denied while binding port already in use", 1, false),
    ).toMatchObject({ kind: "eacces" });
  });
});

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
    ).rejects.toThrow(/eacces/);
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
