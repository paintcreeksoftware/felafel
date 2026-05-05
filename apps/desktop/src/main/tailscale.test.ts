// Tier 1 — unit tests for the pure helpers in tailscale.ts. Runs in
// milliseconds, no `tailscale` binary required, no spawn, no electron.
//
// The IO functions (findBinary, probeStatus, runUp) are exercised in the
// adjacent integration test file, gated on whether tailscale is installed
// on the test machine.
import { describe, expect, it } from "vitest";
import {
  classifyServeError,
  classifyUpError,
  parseServeConfigJson,
  parseStatusJson,
} from "@felafel/desktop/main/tailscale";

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
