// Tier 1 — unit tests for OrchestratorManager's tailnet-serve wiring.
// Avoids spawning the real orchestrator child by exercising
// setupTailnetServe / stop directly with a hand-mocked TailscaleManager.
// The full lifecycle (real spawn + /health) lives in
// orchestrator.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorManager } from "@felafel/desktop/main/orchestrator";
import { type TailscaleManager } from "@felafel/tailscale";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));

/** Type-only escape hatch so tests can call private helpers + reach internal state. */
interface Privates {
  setupTailnetServe(localPort: number): Promise<void>;
  process: { kill: () => void; once: (ev: string, cb: () => void) => void } | null;
  publishedTailnetPort: number | null;
  currentLocalPort: number | null;
}

/**
 *
 * @param overrides
 */
function mockTailscale(overrides: Partial<TailscaleManager> = {}): TailscaleManager {
  return {
    probeStatus: vi.fn().mockResolvedValue({ kind: "missing-binary", path: null }),
    publishServe: vi.fn().mockResolvedValue(),
    unpublishServe: vi.fn().mockResolvedValue(),
    readServePublished: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as TailscaleManager;
}

const connectedStatus = { kind: "connected", tailnet: "t", selfName: "s" } as const;

describe("OrchestratorManager.setupTailnetServe", () => {
  beforeEach(() => {
    delete process.env.FELAFEL_ORCHESTRATOR_TAILNET_PORT;
  });
  afterEach(() => {
    delete process.env.FELAFEL_ORCHESTRATOR_TAILNET_PORT;
  });

  it("no-ops when Tailscale isn't connected", async () => {
    const ts = mockTailscale();
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(ts.publishServe).not.toHaveBeenCalled();
    expect(ts.unpublishServe).not.toHaveBeenCalled();
  });

  it("publishes when connected and no prior mapping exists", async () => {
    const ts = mockTailscale({ probeStatus: vi.fn().mockResolvedValue(connectedStatus) });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(ts.publishServe).toHaveBeenCalledWith({ tailnetPort: 9090, localPort: 54321 });
    expect(ts.unpublishServe).not.toHaveBeenCalled();
  });

  it("reaps a stale mapping pointing at a different local port before publishing", async () => {
    const ts = mockTailscale({
      probeStatus: vi.fn().mockResolvedValue(connectedStatus),
      readServePublished: vi.fn().mockResolvedValue({ targetLocalPort: 11111 }),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(ts.unpublishServe).toHaveBeenCalledWith({ tailnetPort: 9090 });
    expect(ts.publishServe).toHaveBeenCalledWith({ tailnetPort: 9090, localPort: 54321 });
  });

  it("skips reap when an existing mapping already points at the new port", async () => {
    const ts = mockTailscale({
      probeStatus: vi.fn().mockResolvedValue(connectedStatus),
      readServePublished: vi.fn().mockResolvedValue({ targetLocalPort: 54321 }),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(ts.unpublishServe).not.toHaveBeenCalled();
  });

  it("swallows publishServe failures so loopback still works", async () => {
    const ts = mockTailscale({
      probeStatus: vi.fn().mockResolvedValue(connectedStatus),
      publishServe: vi.fn().mockRejectedValue(new Error("publish failed")),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(m.setupTailnetServe(54321)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("respects FELAFEL_ORCHESTRATOR_TAILNET_PORT when set", async () => {
    process.env.FELAFEL_ORCHESTRATOR_TAILNET_PORT = "12345";
    const ts = mockTailscale({ probeStatus: vi.fn().mockResolvedValue(connectedStatus) });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(ts.publishServe).toHaveBeenCalledWith({ tailnetPort: 12345, localPort: 54321 });
  });
});

describe("OrchestratorManager.getServeDegradation", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns null when setupTailnetServe ran without error", async () => {
    const ts = mockTailscale({ probeStatus: vi.fn().mockResolvedValue(connectedStatus) });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(m.getServeDegradation()).toBeNull();
  });

  it("captures classification fields from a typed ServeFailureError", async () => {
    // publishServe throws an Error decorated with `classification` per
    // PAI-106's typed-tag pattern. setupTailnetServe should read the
    // classification's message + remediation into the degradation field.
    const taggedError: Error & {
      classification: { kind: string; message: string; remediation?: string };
    } = Object.assign(new Error("tailscale serve (eacces): denied"), {
      classification: {
        kind: "eacces",
        message: "Felafel doesn't have permission to talk to the Tailscale daemon socket.",
        remediation: "sudo tailscale set --operator=$USER",
      },
    });
    const ts = mockTailscale({
      probeStatus: vi.fn().mockResolvedValue(connectedStatus),
      publishServe: vi.fn().mockRejectedValue(taggedError),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(m.getServeDegradation()).toEqual({
      reason: "Felafel doesn't have permission to talk to the Tailscale daemon socket.",
      remediation: "sudo tailscale set --operator=$USER",
    });
  });

  it("falls back to error.message when the throw isn't a typed ServeFailureError", async () => {
    const ts = mockTailscale({
      probeStatus: vi.fn().mockResolvedValue(connectedStatus),
      publishServe: vi.fn().mockRejectedValue(new Error("something untyped")),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(m.getServeDegradation()).toEqual({ reason: "something untyped" });
  });

  it("clears a stale degradation on a new successful setupTailnetServe", async () => {
    // First run fails → degradation captured.
    const ts = mockTailscale({
      probeStatus: vi.fn().mockResolvedValue(connectedStatus),
      publishServe: vi.fn().mockRejectedValueOnce(new Error("first failure")).mockResolvedValueOnce(),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    await m.setupTailnetServe(54321);
    expect(m.getServeDegradation()).not.toBeNull();
    // Second run succeeds → degradation reset to null.
    await m.setupTailnetServe(54321);
    expect(m.getServeDegradation()).toBeNull();
  });
});

describe("OrchestratorManager.refreshTailnetServe", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("is a no-op (returns current degradation) before start() bound a port", async () => {
    const ts = mockTailscale({ probeStatus: vi.fn().mockResolvedValue(connectedStatus) });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    expect(m.currentLocalPort).toBeNull();
    expect(await m.refreshTailnetServe()).toBeNull();
    expect(ts.publishServe).not.toHaveBeenCalled();
  });

  it("re-attempts serve setup when start() has bound a port", async () => {
    const ts = mockTailscale({ probeStatus: vi.fn().mockResolvedValue(connectedStatus) });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    m.currentLocalPort = 54321;
    await m.refreshTailnetServe();
    expect(ts.publishServe).toHaveBeenCalledWith({ tailnetPort: 9090, localPort: 54321 });
  });

  // The PAI-138 regression: this exercises both directions of the
  // operator-change flow. publishServe throws EACCES on first call
  // (operator=root mid-session) and succeeds on the second (recovery
  // via `sudo tailscale set --operator=$USER`). refreshTailnetServe
  // must surface the degradation on the first refresh AND clear it on
  // the next — both were broken before this commit because the
  // Tailscale refresh handler only re-probed status.
  it("flips degradation across operator change → recovery", async () => {
    const taggedError: Error & {
      classification: { kind: string; message: string; remediation?: string };
    } = Object.assign(new Error("tailscale serve (eacces): denied"), {
      classification: {
        kind: "eacces",
        message: "Felafel doesn't have permission to talk to the Tailscale daemon socket.",
        remediation: "sudo tailscale set --operator=$USER",
      },
    });
    const ts = mockTailscale({
      probeStatus: vi.fn().mockResolvedValue(connectedStatus),
      publishServe: vi
        .fn()
        .mockRejectedValueOnce(taggedError)
        .mockResolvedValueOnce(),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    m.currentLocalPort = 54321;
    const first = await m.refreshTailnetServe();
    expect(first).toEqual({
      reason: "Felafel doesn't have permission to talk to the Tailscale daemon socket.",
      remediation: "sudo tailscale set --operator=$USER",
    });
    const second = await m.refreshTailnetServe();
    expect(second).toBeNull();
  });
});

describe("OrchestratorManager.stop", () => {
  /**
   * Build a manager with a fake child so stop() has something to kill without a real spawn.
   * @param ts
   */
  function withFakeProcess(ts: TailscaleManager): {
    manager: OrchestratorManager & Privates;
    kill: ReturnType<typeof vi.fn>;
  } {
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    const kill = vi.fn();
    m.process = {
      kill,
      // Mirrors EventEmitter#once — callback shape is the API we're stubbing,
      // not a style choice. Fires "exit" synchronously so SIGTERM-grace
      // never trips and the test stays deterministic.
      /* oxlint-disable prefer-await-to-callbacks -- stubbing EventEmitter#once API */
      once: (event: string, cb: () => void) => {
        if (event === "exit") {
          cb();
        }
      },
      /* oxlint-enable prefer-await-to-callbacks */
    };
    return { manager: m, kill };
  }

  it("kills the child first, then propagates the unpublish error", async () => {
    const ts = mockTailscale({
      unpublishServe: vi.fn().mockRejectedValue(new Error("tailscale serve (eacces): denied")),
    });
    const { manager, kill } = withFakeProcess(ts);
    // Simulate the post-start state where setupTailnetServe DID publish.
    manager.publishedTailnetPort = 9090;
    await expect(manager.stop()).rejects.toThrow(/eacces/u);
    // Child WAS killed before the unpublish error propagated — no orphan.
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(ts.unpublishServe).toHaveBeenCalled();
  });

  it("skips unpublish when nothing was published (Tailscale-less host)", async () => {
    const ts = mockTailscale();
    const { manager, kill } = withFakeProcess(ts);
    // Default state: publishedTailnetPort is null (start() never published).
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(ts.unpublishServe).not.toHaveBeenCalled();
  });
});
