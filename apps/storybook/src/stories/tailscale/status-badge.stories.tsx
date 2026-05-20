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
