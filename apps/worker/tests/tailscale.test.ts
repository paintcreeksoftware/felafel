// Unit tests for getTailnetIPv4. Mocks node:child_process so the test
// doesn't depend on a real `tailscale` binary or daemon.
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChildProcess, execFile } from "node:child_process";
import { getTailnetIPv4 } from "@felafel/worker/tailscale";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

afterEach(() => {
  mockedExecFile.mockReset();
});

/**
 * Stub the next `execFile("tailscale", ["ip", "-4"], ...)` call. Mimics
 * Node's callback-style execFile signature so promisify-wrapped callers
 * resolve/reject correctly.
 */
function stubExecFile(opts: {
  stdout?: string;
  error?: Error;
}): void {
  // Cast through unknown — the real execFile signature has many overloads
  // and getting a perfect typing here is mock-test churn for no payoff.
  /* oxlint-disable prefer-await-to-callbacks -- stubbing callback-style execFile API */
  mockedExecFile.mockImplementation(((
    _file: string,
    _args: string[],
    _options: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    if (opts.error) {
      cb(opts.error, "", "");
    } else {
      cb(null, opts.stdout ?? "", "");
    }
    return {} as ChildProcess;
  }) as unknown as typeof execFile);
  /* oxlint-enable prefer-await-to-callbacks */
}

describe("getTailnetIPv4", () => {
  it("returns the parsed IPv4 when tailscale prints a single line", async () => {
    stubExecFile({ stdout: "100.67.155.3\n" });
    expect(await getTailnetIPv4()).toBe("100.67.155.3");
  });

  it("trims trailing whitespace + newline", async () => {
    stubExecFile({ stdout: "100.67.155.3  \n" });
    expect(await getTailnetIPv4()).toBe("100.67.155.3");
  });

  it("returns the first IPv4 line when stdout has multiple lines", async () => {
    // Some tailscale versions print v4 then v6 on subsequent lines; we
    // asked for -4 explicitly but stay defensive about the exact output.
    stubExecFile({ stdout: "100.67.155.3\nfd7a:115c:a1e0::7d01:9b03\n" });
    expect(await getTailnetIPv4()).toBe("100.67.155.3");
  });

  it("returns null when execFile rejects (binary missing / ENOENT)", async () => {
    const enoent: Error & { code?: string } = new Error("spawn tailscale ENOENT");
    enoent.code = "ENOENT";
    stubExecFile({ error: enoent });
    expect(await getTailnetIPv4()).toBeNull();
  });

  it("returns null when execFile rejects with any other error", async () => {
    stubExecFile({ error: new Error("daemon not running") });
    expect(await getTailnetIPv4()).toBeNull();
  });

  it("returns null when stdout is empty", async () => {
    stubExecFile({ stdout: "" });
    expect(await getTailnetIPv4()).toBeNull();
  });

  it("returns null when stdout is not a valid IPv4 (e.g. an IPv6 address)", async () => {
    stubExecFile({ stdout: "fd7a:115c:a1e0::7d01:9b03\n" });
    expect(await getTailnetIPv4()).toBeNull();
  });

  it("returns null when an octet is out of range", async () => {
    stubExecFile({ stdout: "100.67.300.3\n" });
    expect(await getTailnetIPv4()).toBeNull();
  });

  it("returns null on a non-IP string", async () => {
    stubExecFile({ stdout: "not an ip address\n" });
    expect(await getTailnetIPv4()).toBeNull();
  });
});
