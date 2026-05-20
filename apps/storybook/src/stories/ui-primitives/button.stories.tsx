// One canonical story per `cva` variant the Button primitive exposes
// (default, destructive, outline, secondary, ghost, link). Size is a
// separate variant axis but isn't enumerated here — drift on size
// classnames is more likely to surface via the consumers
// (`size="icon"` in TailscalePill's refresh button, etc.) than via a
// matrix story.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@felafel/ui/components/ui/button";

const meta = {
  title: "Primitives/Button",
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — solid primary color, the most prominent CTA. */
export const Default: Story = { args: { variant: "default", children: "Click me" } };

/** Destructive — red CTA for irreversible actions. */
export const Destructive: Story = { args: { variant: "destructive", children: "Delete" } };

/** Outline — border-only, low-emphasis secondary action. */
export const Outline: Story = { args: { variant: "outline", children: "Cancel" } };

/** Secondary — muted background, alongside default for paired CTAs. */
export const Secondary: Story = { args: { variant: "secondary", children: "Save draft" } };

/** Ghost — no chrome until hover; used inside menus + toolbars. */
export const Ghost: Story = { args: { variant: "ghost", children: "Open" } };

/** Link — looks like an anchor, but submits a form / triggers JS. */
export const Link: Story = { args: { variant: "link", children: "Learn more" } };
