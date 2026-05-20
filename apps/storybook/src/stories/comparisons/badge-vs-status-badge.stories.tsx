// Side-by-side comparison: bare shadcn `<Badge>` next to the composed
// `<StatusBadge>` for each status branch. The whole point of this file
// is that any layered-className drift (a stray `border-`, `bg-`, or
// padding change on StatusBadge) jumps out visually when held next to
// the canonical primitive. Snapshots will pin both halves, so the
// reviewer sees the diff inline.
//
// Story matrix matches `status-badge.stories.tsx` exactly so a 1:1
// drift comparison is trivial.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusBadge } from "@felafel/tailscale/ui/StatusBadge";
import { Badge } from "@felafel/ui/components/ui/badge";

const FAKE_TAILNET = "felafel.ts.net" as const;
const FAKE_HOST = "felafel-laptop" as const;

const meta = {
  title: "Comparisons/Badge vs StatusBadge",
  component: StatusBadge,
  render: (args) => (
    <div className="flex items-center gap-4">
      <Badge variant="default">Reference badge</Badge>
      <StatusBadge {...args} />
    </div>
  ),
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Connecting — busy spinner inside the badge. */
export const Connecting: Story = {
  args: {
    busy: "connecting",
    status: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
    serveDegradation: null,
  },
};

/** Refreshing — same spinner, "Refreshing…" copy. */
export const Refreshing: Story = {
  args: {
    busy: "refreshing",
    status: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
    serveDegradation: null,
  },
};

/** Checking — initial-probe state before daemon resolves. */
export const Checking: Story = {
  args: {
    busy: null,
    status: { kind: "unknown" },
    serveDegradation: null,
  },
};

/** Connected — happy path, no degradation. */
export const Connected: Story = {
  args: {
    busy: null,
    status: { kind: "connected", tailnet: FAKE_TAILNET, selfName: FAKE_HOST },
    serveDegradation: null,
  },
};

/** Connected with serve degradation — amber pill + tooltip. */
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

/** Disconnected, no daemon — "systemctl start tailscaled" needed. */
export const DisconnectedNoDaemon: Story = {
  args: {
    busy: null,
    status: { kind: "disconnected", reason: "no-daemon" },
    serveDegradation: null,
  },
};

/** Disconnected, needs login — paste-in pre-auth key flow. */
export const DisconnectedNeedsLogin: Story = {
  args: {
    busy: null,
    status: { kind: "disconnected", reason: "needs-login" },
    serveDegradation: null,
  },
};

/** Error — daemon errored, typically EACCES on the daemon socket. */
export const ErrorState: Story = {
  args: {
    busy: null,
    status: { kind: "error", message: "EACCES on /var/run/tailscale/tailscaled.sock" },
    serveDegradation: null,
  },
};

/** Missing binary — `tailscale` not on PATH. */
export const MissingBinary: Story = {
  args: {
    busy: null,
    status: { kind: "missing-binary", path: null },
    serveDegradation: null,
  },
};
