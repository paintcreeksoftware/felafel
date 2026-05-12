// Component tests for StatusBadge — the busy/status → JSX mapping
// that drives every visible state of the Tailscale pill. Lives in
// the ui project (happy-dom) since this is React-DOM territory.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBadge } from "@felafel/tailscale/ui/StatusBadge";

afterEach(() => {
  cleanup();
});

describe("StatusBadge busy states (win over status)", () => {
  it("renders the connecting spinner copy when busy=connecting", () => {
    render(
      <StatusBadge
        status={{ kind: "connected", tailnet: "example", selfName: "host" }}
        busy="connecting"
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Connecting/u)).toBeDefined();
  });

  it("renders the refreshing spinner copy when busy=refreshing", () => {
    render(
      <StatusBadge
        status={{ kind: "connected", tailnet: "example", selfName: "host" }}
        busy="refreshing"
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Refreshing/u)).toBeDefined();
  });
});

describe("StatusBadge status mapping (busy=null)", () => {
  it("connected → shows the tailnet name", () => {
    render(
      <StatusBadge
        status={{ kind: "connected", tailnet: "my-net", selfName: "host" }}
        busy={null}
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Connected to my-net/u)).toBeDefined();
  });

  it("connected + serveDegradation → amber 'serve degraded' badge with the testid", () => {
    render(
      <StatusBadge
        status={{ kind: "connected", tailnet: "my-net", selfName: "host" }}
        busy={null}
        serveDegradation={{ reason: "broken", remediation: "fix it" }}
      />,
    );
    expect(screen.getByTestId("ts-pill-degraded")).toBeDefined();
    expect(screen.getByText(/serve degraded/u)).toBeDefined();
  });

  it("disconnected/no-daemon → daemon-not-running copy", () => {
    render(
      <StatusBadge
        status={{ kind: "disconnected", reason: "no-daemon" }}
        busy={null}
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Tailscale daemon not running/u)).toBeDefined();
  });

  it("disconnected/needs-login → connect-to-Tailscale copy", () => {
    render(
      <StatusBadge
        status={{ kind: "disconnected", reason: "needs-login" }}
        busy={null}
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Connect to Tailscale/u)).toBeDefined();
  });

  it("error → error copy", () => {
    render(
      <StatusBadge
        status={{ kind: "error", message: "spawn EACCES" }}
        busy={null}
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Tailscale error/u)).toBeDefined();
  });

  it("missing-binary → install-prompt copy", () => {
    render(
      <StatusBadge
        status={{ kind: "missing-binary", path: null }}
        busy={null}
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Tailscale not installed/u)).toBeDefined();
  });

  it("unknown → 'Checking…' fallback", () => {
    render(
      <StatusBadge
        status={{ kind: "unknown" }}
        busy={null}
        serveDegradation={null}
      />,
    );
    expect(screen.getByText(/Checking/u)).toBeDefined();
  });
});
