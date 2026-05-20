// Component tests for TailscalePill — the renderer-side pill that
// glues the StatusBadge/MissingBinaryTooltip view together with the
// `window.api` IPC surface. Tests stub `window.api` so the pill
// renders deterministically against canned IPC responses.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type TailscaleStatus } from "@felafel/shared";
import { TailscalePill } from "@felafel/tailscale/ui/Pill";

/**
 * Build a `window.api` stub with the four channels the pill talks to.
 * Each call is captured so tests can assert on argument shape +
 * call counts. The status-subscription callback is exposed via
 * `pushStatus` so tests can simulate a main-process broadcast.
 * @returns the api stub + helpers for tests to drive it
 */
function stubWindowApi() {
  let subscriber: ((s: TailscaleStatus) => void) | null = null;
  const api = {
    tailscaleStatus: vi.fn().mockResolvedValue({ kind: "unknown" } as TailscaleStatus),
    onTailscaleStatus: vi.fn((cb: (s: TailscaleStatus) => void) => {
      subscriber = cb;
      return () => {
        subscriber = null;
      };
    }),
    tailscaleConnect: vi.fn().mockResolvedValue({ ok: true }),
    tailscaleRefresh: vi.fn().mockResolvedValue({ kind: "unknown" } as TailscaleStatus),
  };
  return {
    api,
    /**
     * Simulate a main-process broadcast via the subscription.
     * @param s - the TailscaleStatus to push to the subscriber
     */
    pushStatus(s: TailscaleStatus) {
      subscriber?.(s);
    },
  };
}

beforeEach(() => {
  const { api } = stubWindowApi();
  // Cast through unknown — the real DesktopApi has more methods than
  // the pill uses; the stub only mocks what's actually called.
  (window as unknown as { api: typeof api }).api = api;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TailscalePill — initial render", () => {
  it("renders a 'Checking…' state on mount while the initial status is pending", () => {
    render(<TailscalePill />);
    expect(screen.getByText(/Checking/u)).toBeDefined();
  });

  it("subscribes to status pushes on mount", () => {
    render(<TailscalePill />);
    const { api } = window as unknown as { api: { onTailscaleStatus: ReturnType<typeof vi.fn> } };
    expect(api.onTailscaleStatus).toHaveBeenCalledOnce();
  });
});

describe("TailscalePill — status updates", () => {
  it("reflects a 'connected' push by rendering the tailnet name", async () => {
    const { api } = stubWindowApi();
    (window as unknown as { api: typeof api }).api = api;
    render(<TailscalePill />);
    const pushed: TailscaleStatus = { kind: "connected", tailnet: "my-net", selfName: "host" };
    act(() => {
      const cb = api.onTailscaleStatus.mock.calls[0]?.[0];
      cb?.(pushed);
    });
    // findByLabelText (not getByLabelText) — Pill.tsx's mount-time
    // tailscaleStatus() promise resolves after the push and can race
    // the state back to `unknown`, so the assertion has to poll for
    // the connected render window. The aria-label is the load-bearing
    // contract (visible text == tailnet only; verbose phrase lives
    // entirely in the label).
    expect(await screen.findByLabelText("Connected to my-net")).toBeDefined();
  });

  it("wraps a missing-binary status in the install-hint tooltip", async () => {
    const { api } = stubWindowApi();
    (window as unknown as { api: typeof api }).api = api;
    render(<TailscalePill />);
    act(() => {
      const cb = api.onTailscaleStatus.mock.calls[0]?.[0];
      cb?.({ kind: "missing-binary", path: null });
    });
    expect(await screen.findByText(/Tailscale not installed/u)).toBeDefined();
  });
});

describe("TailscalePill — refresh button", () => {
  it("invokes tailscaleRefresh on click", async () => {
    const { api } = stubWindowApi();
    (window as unknown as { api: typeof api }).api = api;
    render(<TailscalePill />);
    // Push a connected status so the pill isn't in the missing-binary
    // disabled branch.
    act(() => {
      const cb = api.onTailscaleStatus.mock.calls[0]?.[0];
      cb?.({ kind: "connected", tailnet: "net", selfName: "h" });
    });
    const refresh = await screen.findByLabelText(/Refresh Tailscale status/u);
    fireEvent.click(refresh);
    expect(api.tailscaleRefresh).toHaveBeenCalledOnce();
  });
});
