// Tier 1 — unit tests for OrchestratorManager's tailnet-serve wiring.
// Avoids spawning the real orchestrator child by exercising
// setupTailnetServe / stop directly with a hand-mocked TailscaleManager.
// The full lifecycle (real spawn + /health) lives in
// orchestrator.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorManager } from "@felafel/desktop/main/orchestrator";
import { type TailscaleManager } from "@felafel/desktop/main/tailscale";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));

/** Type-only escape hatch so tests can call private helpers + reach internal state. */
interface Privates {
  setupTailnetServe(localPort: number): Promise<void>;
  process: { kill: () => void; once: (ev: string, cb: () => void) => void } | null;
}

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

describe("OrchestratorManager.stop unpublish error", () => {
  it("kills the child first, then propagates the unpublish error", async () => {
    const ts = mockTailscale({
      unpublishServe: vi.fn().mockRejectedValue(new Error("tailscale serve (eacces): denied")),
    });
    const m = new OrchestratorManager(ts) as OrchestratorManager & Privates;
    // Inject a fake child process so stop() has something to kill without
    // requiring a real spawn. The fake fires "exit" synchronously so the
    // SIGTERM-grace timer never trips.
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
    await expect(m.stop()).rejects.toThrow(/eacces/);
    // Child WAS killed before the unpublish error propagated — no orphan.
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(ts.unpublishServe).toHaveBeenCalled();
  });
});
