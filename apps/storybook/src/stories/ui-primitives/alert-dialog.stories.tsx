// AlertDialog is a Radix compound with a confirm/cancel action pair
// (modal flavor of Dialog). Stories pin both the trigger surface and
// the surfaced modal — the Action button intentionally borrows
// buttonVariants("outline") so drift on that primitive shows up
// here too.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@felafel/ui/components/ui/alert-dialog";
import { Button } from "@felafel/ui/components/ui/button";

const meta = {
  title: "Primitives/AlertDialog",
  component: AlertDialog,
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" data-testid="trigger">
          Delete worker
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will deregister the worker from the orchestrator and stop any
            in-flight jobs it owns.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
} satisfies Meta<typeof AlertDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — trigger button only, modal closed. */
export const Default: Story = {};

/** Open — play function clicks the trigger so Radix surfaces the alert dialog. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByTestId("trigger");
    await userEvent.click(trigger);
  },
};
