// Stories for the StatusPill renderer component. Two stories — one
// per Worker liveness state (active / stale) — so drift on either
// color treatment is caught at snapshot time.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { StatusPill } from "@felafel/desktop/components/status-pill";

const meta = {
  title: "Desktop/StatusPill",
  component: StatusPill,
} satisfies Meta<typeof StatusPill>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Active — worker heartbeating; emerald pill. */
export const Active: Story = { args: { status: "active" } };

/** Stale — worker stopped heartbeating past the sweep threshold; amber pill. */
export const Stale: Story = { args: { status: "stale" } };
