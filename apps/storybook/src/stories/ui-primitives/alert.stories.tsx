// One canonical story per `cva` variant the Alert primitive exposes
// (default, destructive). Both stories render the full
// Alert + AlertTitle + AlertDescription composition because Alert on
// its own is a styled `<div role="alert">` with no content.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Alert, AlertDescription, AlertTitle } from "@felafel/ui/components/ui/alert";

const meta = {
  title: "Primitives/Alert",
  component: Alert,
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — neutral background, informational tone. */
export const Default: Story = {
  args: {
    variant: "default",
    children: (
      <>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>
          Your tailnet status will refresh on the next reconciliation tick.
        </AlertDescription>
      </>
    ),
  },
};

/** Destructive — red border + text, for error / required action. */
export const Destructive: Story = {
  args: {
    variant: "destructive",
    children: (
      <>
        <AlertTitle>Tailscale error</AlertTitle>
        <AlertDescription>
          The daemon socket returned EACCES. Run{" "}
          <code className="font-mono">sudo tailscale set --operator=$USER</code>.
        </AlertDescription>
      </>
    ),
  },
};
