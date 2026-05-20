// One canonical story per `cva` variant the Badge primitive exposes
// (default, secondary, destructive, outline). Reviewer reference for
// any future `<Badge variant="..."/>` usage — drift on this surface
// shows up at snapshot diff time.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "@felafel/ui/components/ui/badge";

const meta = {
  title: "Primitives/Badge",
  component: Badge,
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — primary background, transparent border. */
export const Default: Story = { args: { variant: "default", children: "Default" } };

/** Secondary — muted background for de-emphasized counts/tags. */
export const Secondary: Story = { args: { variant: "secondary", children: "Secondary" } };

/** Destructive — red background for error/danger states. */
export const Destructive: Story = { args: { variant: "destructive", children: "Destructive" } };

/** Outline — text-only with default border, no fill. */
export const Outline: Story = { args: { variant: "outline", children: "Outline" } };
