// Storybook usage-drift surface for TailscalePill. Covers the seven
// externally-driven status branches (the ones a main-process push can
// trigger). Internal busy/refreshing states are not enumerated here —
// they're already pinned at the StatusBadge level in
// `status-badge.stories.tsx`, and reaching them through the Pill would
// require play functions with never-resolving IPC mocks; the marginal
// drift-detection value isn't worth the test surface area.
//
// The decorator wires `window.api` from per-story `parameters` so each
// story declares its desired status declaratively (no per-story
// boilerplate). Pill's useEffect picks the status up via the initial
// `tailscaleStatus()` resolution on mount.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { type DesktopApi, type TailscaleStatus } from "@felafel/shared";
import { TailscalePill } from "@felafel/tailscale/ui/Pill";
import { type ServeDegradation } from "@felafel/tailscale/ui/StatusBadge";

interface PillArgs {
  tailnetServeDegradation?: ServeDegradation | null;
}

/**
 * Stub unsubscribe returned from `onTailscaleStatus` — stories don't
 * exercise re-subscription, so the cleanup is a no-op. Lifted to module
 * scope to satisfy `unicorn/consistent-function-scoping`.
 */
function noopUnsubscribe(): void {
  // intentionally empty
}

interface PillStoryParameters {
  tailscaleStatus?: TailscaleStatus;
}

/**
 * Build a `window.api`-shaped stub that resolves the four IPC channels
 * the Pill talks to, with a fixed status driving the read path. Used
 * by the storybook decorator below; lifted to module scope so the
 * inner arrow functions aren't recreated on every render (and to
 * satisfy `unicorn/consistent-function-scoping`).
 * @param status - the TailscaleStatus the Pill should observe
 * @returns a Partial<DesktopApi> shaped subset suitable for the Pill
 */
function makeApiStub(status: TailscaleStatus): Pick<
  DesktopApi,
  "tailscaleStatus" | "onTailscaleStatus" | "tailscaleRefresh" | "tailscaleConnect"
> {
  return {
    tailscaleStatus: () => Promise.resolve(status),
    onTailscaleStatus: () => noopUnsubscribe,
    tailscaleRefresh: () => Promise.resolve(status),
    tailscaleConnect: () => Promise.resolve({ ok: true, kind: "connected" }),
  };
}

const meta: Meta<PillArgs> = {
  title: "Tailscale/TailscalePill",
  component: TailscalePill,
  decorators: [
    (Story, context) => {
      const params = context.parameters as PillStoryParameters;
      const status: TailscaleStatus = params.tailscaleStatus ?? { kind: "unknown" };
      Object.assign(window, { api: makeApiStub(status) });
      return <Story />;
    },
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

const FAKE_TAILNET = "felafel.ts.net" as const;
const FAKE_HOST = "felafel-laptop" as const;

/** Initial-probe state — no `tailscaleStatus()` resolution yet. */
export const Checking: Story = {};

/** Daemon connected to a tailnet; happy path. */
export const Connected: Story = {
  parameters: {
    tailscaleStatus: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
  },
};

/** Daemon connected, but orchestrator's `tailscale serve` failed — amber pill via prop. */
export const ConnectedServeDegraded: Story = {
  args: {
    tailnetServeDegradation: {
      reason: "tailscale serve returned non-zero on bring-up",
      remediation: "tailscale serve --bg --https=443 http://127.0.0.1:9090",
    },
  },
  parameters: {
    tailscaleStatus: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
  },
};

/** Tailscale daemon isn't running. */
export const DisconnectedNoDaemon: Story = {
  parameters: {
    tailscaleStatus: { kind: "disconnected", reason: "no-daemon" },
  },
};

/** Daemon up, user signed out — pill click opens the paste-in dialog. */
export const DisconnectedNeedsLogin: Story = {
  parameters: {
    tailscaleStatus: { kind: "disconnected", reason: "needs-login" },
  },
};

/** Daemon errored — typically EACCES on the daemon socket. */
export const ErrorState: Story = {
  parameters: {
    tailscaleStatus: { kind: "error", message: "EACCES on /var/run/tailscale/tailscaled.sock" },
  },
};

/** `tailscale` not on PATH — pill greys out, wrapped in install-hint tooltip. */
export const MissingBinary: Story = {
  parameters: {
    tailscaleStatus: { kind: "missing-binary", path: null },
  },
};
