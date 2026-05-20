// Tooltip is a Radix compound (Provider/Root/Trigger/Content) with no
// `cva` variants. The only meaningful drift surface is the content's
// styling (background, padding, animation). Two stories: trigger
// hovered (closed) and surfaced (Open via play function).
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@felafel/ui/components/ui/tooltip";

const meta = {
  title: "Primitives/Tooltip",
  component: Tooltip,
  render: () => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" data-testid="anchor">
            Hover me
          </button>
        </TooltipTrigger>
        <TooltipContent>Tooltip content</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — trigger anchor visible, tooltip closed. */
export const Default: Story = {};

/** Open — play function focuses the trigger so Radix surfaces the content. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByTestId("anchor");
    await userEvent.tab();
    trigger.focus();
  },
};
