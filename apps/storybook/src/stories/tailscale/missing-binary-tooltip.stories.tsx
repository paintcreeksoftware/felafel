// Storybook usage-drift surface for MissingBinaryTooltip. Two stories
// pin the only externally-visible states: tooltip-closed (Default) and
// tooltip-open (Open, driven by a `play` function that focuses the
// trigger). Reviewers can compare the install-hint copy in the Open
// story against the latest install-instructions URL drift.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { MissingBinaryTooltip } from "@felafel/tailscale/ui/MissingBinaryTooltip";

const meta = {
  title: "Tailscale/MissingBinaryTooltip",
  component: MissingBinaryTooltip,
} satisfies Meta<typeof MissingBinaryTooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Tooltip closed — the trigger anchor renders verbatim. */
export const Default: Story = {
  args: {
    children: <span data-testid="anchor">Tailscale not installed</span>,
  },
};

/**
 * Tooltip open — focuses the trigger to surface the install-hint copy
 * via Radix's keyboard-focus path. Snapshot will pin the surfaced
 * content (`rpm-ostree install tailscale`, `sudo apt install tailscale`)
 * so a regression in the copy is caught.
 */
export const Open: Story = {
  args: {
    children: <span data-testid="anchor">Tailscale not installed</span>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByTestId("anchor");
    await userEvent.tab();
    trigger.focus();
  },
};
