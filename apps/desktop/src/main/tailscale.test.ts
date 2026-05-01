// Tier 1 — unit tests for the pure helpers in tailscale.ts. Runs in
// milliseconds, no `tailscale` binary required, no spawn, no electron.
//
// The IO functions (findBinary, probeStatus, runUp) are exercised in the
// adjacent integration test file, gated on whether tailscale is installed
// on the test machine.
import { describe, expect, it } from "vitest";
import { classifyUpError, parseStatusJson } from "@felafel/desktop/main/tailscale";

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
