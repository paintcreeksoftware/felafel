// Tier 1 — unit tests for the pure parsers in parse.ts. Runs in
// milliseconds, no `tailscale` binary required, no spawn, no electron.
import { describe, expect, it } from "vitest";
import { parseStatusJson } from "@felafel/tailscale/parse";

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
