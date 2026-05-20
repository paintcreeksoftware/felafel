// Dialog is a Radix compound — closed it's invisible (the trigger is
// what's rendered), opened it portals to body. Two stories: trigger
// rendered (Default), dialog surfaced (Open via play). The Open
// snapshot pins the overlay + content classnames; reviewers see
// changes to dialog chrome at PR time.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { Button } from "@felafel/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@felafel/ui/components/ui/dialog";

const meta = {
  title: "Primitives/Dialog",
  component: Dialog,
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button data-testid="trigger">Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect to Tailscale</DialogTitle>
          <DialogDescription>
            Paste a pre-auth key from the admin console to register this machine.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — trigger button rendered, dialog closed. */
export const Default: Story = {};

/** Open — play function clicks the trigger so Radix surfaces the dialog. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByTestId("trigger");
    await userEvent.click(trigger);
  },
};
