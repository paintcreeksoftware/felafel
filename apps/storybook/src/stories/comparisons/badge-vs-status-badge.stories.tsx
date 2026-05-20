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
