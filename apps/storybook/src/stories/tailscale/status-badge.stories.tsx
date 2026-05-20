// Storybook usage-drift surface for StatusBadge. Every visual branch
// of the busy/status matrix in packages/tailscale/src/ui/StatusBadge.tsx
// gets its own named story so a side-by-side comparison against the bare
// shadcn Badge (landing in PAI-148_2) makes any layered-className drift
// obvious. The branch enumeration mirrors StatusBadge.test.tsx exactly.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusBadge } from "@felafel/tailscale/ui/StatusBadge";

const FAKE_TAILNET = "felafel.ts.net" as const;
const FAKE_HOST = "felafel-laptop" as const;

const meta: Meta<typeof StatusBadge> = {
  title: "Tailscale/StatusBadge",
  component: StatusBadge,
};

export default meta;

type Story = StoryObj<typeof meta>;

/** Local "connecting" busy state — user just clicked Connect. */
export const Connecting: Story = {
  args: {
    busy: "connecting",
    status: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
    serveDegradation: null,
  },
};

/** Local "refreshing" busy state — user clicked the refresh button. */
export const Refreshing: Story = {
  args: {
    busy: "refreshing",
    status: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
    serveDegradation: null,
  },
};

/** Initial-probe state — daemon status hasn't been resolved yet. */
export const Checking: Story = {
  args: {
    busy: null,
    status: { kind: "unknown" },
    serveDegradation: null,
  },
};

/** Happy path — daemon connected to a tailnet, no degradation. */
export const Connected: Story = {
  args: {
    busy: null,
    status: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
    serveDegradation: null,
  },
};

/** Daemon up, but orchestrator's `tailscale serve` setup failed — amber pill + tooltip. */
export const ConnectedServeDegraded: Story = {
  args: {
    busy: null,
    status: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
    serveDegradation: {
      reason: "tailscale serve returned non-zero on bring-up",
      remediation: "tailscale serve --bg --https=443 http://127.0.0.1:9090",
    },
  },
};

/** Tailscale daemon isn't running — "systemctl start tailscaled" needed. */
export const DisconnectedNoDaemon: Story = {
  args: {
    busy: null,
    status: { kind: "disconnected", reason: "no-daemon" },
    serveDegradation: null,
  },
};

/** Daemon is up but the user isn't signed in — paste-in pre-auth key flow. */
export const DisconnectedNeedsLogin: Story = {
  args: {
    busy: null,
    status: { kind: "disconnected", reason: "needs-login" },
    serveDegradation: null,
  },
};

/** Daemon errored — typically EACCES on the daemon socket. */
export const ErrorState: Story = {
  args: {
    busy: null,
    status: { kind: "error", message: "EACCES on /var/run/tailscale/tailscaled.sock" },
    serveDegradation: null,
  },
};

/** Tailscale CLI not found on $PATH — opaque pill with WifiOff icon. */
export const MissingBinary: Story = {
  args: {
    busy: null,
    status: { kind: "missing-binary", path: null },
    serveDegradation: null,
  },
};
