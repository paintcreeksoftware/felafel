// Unit tests for resolveHosts. Exercises the precedence rules between
// WORKER_HOST (advertise) and WORKER_BIND_HOST (bind) without spawning
// the worker process or touching real env vars.
import { describe, expect, it } from "vitest";
import { resolveHosts } from "@felafel/worker/hosts";

describe("resolveHosts", () => {
  describe("when neither env var is set", () => {
    it("uses the autodetected Tailnet IP for both bind and advertise", () => {
      expect(
        resolveHosts({
          explicitAdvertiseHost: undefined,
          explicitBindHost: undefined,
          tailnetIp: "100.67.155.3",
        }),
      ).toEqual({ advertiseHost: "100.67.155.3", bindHost: "100.67.155.3" });
    });

    it("falls back to loopback when no Tailnet IP is available", () => {
      expect(
        resolveHosts({
          explicitAdvertiseHost: undefined,
          explicitBindHost: undefined,
          tailnetIp: null,
        }),
      ).toEqual({ advertiseHost: "127.0.0.1", bindHost: "127.0.0.1" });
    });
  });

  describe("when only WORKER_HOST is set (back-compat)", () => {
    it("uses it for both bind and advertise; ignores Tailnet IP", () => {
      expect(
        resolveHosts({
          explicitAdvertiseHost: "10.0.0.5",
          explicitBindHost: undefined,
          tailnetIp: "100.67.155.3",
        }),
      ).toEqual({ advertiseHost: "10.0.0.5", bindHost: "10.0.0.5" });
    });
  });

  describe("when only WORKER_BIND_HOST is set", () => {
    it("binds explicitly but advertises the autodetected Tailnet IP", () => {
      expect(
        resolveHosts({
          explicitAdvertiseHost: undefined,
          explicitBindHost: "0.0.0.0",
          tailnetIp: "100.67.155.3",
        }),
      ).toEqual({ advertiseHost: "100.67.155.3", bindHost: "0.0.0.0" });
    });

    it("binds explicitly but advertises loopback when no Tailnet IP", () => {
      expect(
        resolveHosts({
          explicitAdvertiseHost: undefined,
          explicitBindHost: "0.0.0.0",
          tailnetIp: null,
        }),
      ).toEqual({ advertiseHost: "127.0.0.1", bindHost: "0.0.0.0" });
    });
  });

  describe("when both env vars are set (userspace-sidecar shape)", () => {
    it("uses each independently", () => {
      // Userspace-mode Tailscale sidecar: advertise the virtual Tailnet IP
      // that other Tailnet nodes can route to via tailscaled, but bind
      // 0.0.0.0 because the IP isn't on any kernel interface here.
      expect(
        resolveHosts({
          explicitAdvertiseHost: "100.78.250.98",
          explicitBindHost: "0.0.0.0",
          tailnetIp: null,
        }),
      ).toEqual({ advertiseHost: "100.78.250.98", bindHost: "0.0.0.0" });
    });

    it("ignores Tailnet IP autodetect when advertise is explicit", () => {
      expect(
        resolveHosts({
          explicitAdvertiseHost: "100.78.250.98",
          explicitBindHost: "0.0.0.0",
          tailnetIp: "100.67.155.3",
        }),
      ).toEqual({ advertiseHost: "100.78.250.98", bindHost: "0.0.0.0" });
    });
  });
});
