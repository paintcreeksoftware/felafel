// Unit tests for `runServeMutation` + `readServePublished`: the
// shared spawn wrapper for `tailscale serve` mutations + the
// read-only config retrieval. Both delegate classification /
// parsing to other modules, so the tests focus on the spawn
// boundary: did the CLI args land right, does the success path
// resolve cleanly, does the failure path throw a ServeFailureError
// with the right classification.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { createLogger, Service } from "@felafel/logs";
import { isServeFailureError } from "@felafel/tailscale/classify";
import { readServePublished, runServeMutation } from "@felafel/tailscale/serve";

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
 * Stub one execa call to resolve with the given result shape. The
 * mutating path checks `exitCode` + `isCanceled`; the read-only
 * path looks at `stdout`. Tests stage whichever is relevant.
 * @param overrides - per-call result fields (sensible defaults below)
 * @param overrides.stdout - stdout the stub returns (default empty)
 * @param overrides.stderr - stderr the stub returns (default empty)
 * @param overrides.exitCode - exit code the stub returns (default 0)
 * @param overrides.isCanceled - whether the stub reports cancellation (default false)
 */
function stubExeca(overrides: { stdout?: string; stderr?: string; exitCode?: number; isCanceled?: boolean }): void {
  vi.mocked(execa).mockResolvedValueOnce({
    stdout: overrides.stdout ?? "",
    stderr: overrides.stderr ?? "",
    exitCode: overrides.exitCode ?? 0,
    isCanceled: overrides.isCanceled ?? false,
  } as unknown as Awaited<ReturnType<typeof execa>>);
}

describe("runServeMutation", () => {
  it("resolves cleanly on a zero exit", async () => {
    stubExeca({});
    await expect(
      runServeMutation(stubBinary, ["serve", "--bg", "--tcp=9090", "tcp://127.0.0.1:54321"], testLogger),
    ).resolves.toBeUndefined();
    expect(execa).toHaveBeenCalledWith(
      stubBinary,
      ["serve", "--bg", "--tcp=9090", "tcp://127.0.0.1:54321"],
      expect.objectContaining({ reject: false }),
    );
  });

  it("throws ServeFailureError with EACCES classification on permission-denied stderr", async () => {
    stubExeca({
      exitCode: 1,
      stderr: "Access denied: serve config denied",
    });
    let caught: unknown;
    try {
      await runServeMutation(stubBinary, ["serve", "--tcp=9090", "off"], testLogger);
    } catch (error) {
      caught = error;
    }
    expect(isServeFailureError(caught)).toBe(true);
    if (isServeFailureError(caught)) {
      expect(caught.classification.kind).toBe("eacces");
      expect(caught.classification.remediation).toBe("sudo tailscale set --operator=$USER");
    }
  });

  it("throws ServeFailureError when the outer timeout cancels the spawn", async () => {
    stubExeca({
      exitCode: null as unknown as number,
      isCanceled: true,
      stderr: "",
    });
    let caught: unknown;
    try {
      await runServeMutation(stubBinary, ["serve"], testLogger);
    } catch (error) {
      caught = error;
    }
    expect(isServeFailureError(caught)).toBe(true);
    if (isServeFailureError(caught)) {
      expect(caught.classification.kind).toBe("timeout");
    }
  });
});

describe("readServePublished", () => {
  it("returns null when stdout is empty (no serve config)", async () => {
    stubExeca({ stdout: "" });
    const result = await readServePublished(stubBinary, 9090, testLogger);
    expect(result).toBeNull();
  });

  it("returns the parsed TCP forward when the requested port is mapped", async () => {
    stubExeca({
      stdout: JSON.stringify({
        TCP: {
          "9090": { TCPForward: "127.0.0.1:54321" },
        },
      }),
    });
    const result = await readServePublished(stubBinary, 9090, testLogger);
    expect(result).toEqual({ targetLocalPort: 54321 });
  });

  it("returns null when the requested port isn't in the config", async () => {
    stubExeca({
      stdout: JSON.stringify({
        TCP: {
          "9091": { TCPForward: "127.0.0.1:54322" },
        },
      }),
    });
    const result = await readServePublished(stubBinary, 9090, testLogger);
    expect(result).toBeNull();
  });
});
