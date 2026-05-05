// Tier 1 — unit tests for OrchestratorManager's tailnet-serve wiring.
// Avoids spawning the real orchestrator child by exercising
// setupTailnetServe / stop directly with a hand-mocked TailscaleManager.
// The full lifecycle (real spawn + /health) lives in
// orchestrator.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorManager } from "@felafel/desktop/main/orchestrator";
import { type TailscaleManager } from "@felafel/desktop/main/tailscale";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));

/** Type-only escape hatch so tests can call private helpers. */
interface Privates {
  setupTailnetServe(localPort: number): Promise<void>;
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
