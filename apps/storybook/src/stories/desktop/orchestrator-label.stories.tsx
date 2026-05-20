// Stories for the OrchestratorLabel renderer component. Each branch
// of the status discriminant gets its own named story so reviewers
// catch any wording / classname drift visually.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { OrchestratorLabel } from "@felafel/desktop/components/orchestrator-label";

const meta = {
  title: "Desktop/OrchestratorLabel",
  component: OrchestratorLabel,
} satisfies Meta<typeof OrchestratorLabel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Ready — origin URL surfaced next to the "ready" badge. */
export const Ready: Story = {
  args: { statusError: null, status: "ready", orchUrl: "http://127.0.0.1:9090" },
};

/** Starting — orchestrator spawn in flight; no URL yet. */
export const Starting: Story = {
  args: { statusError: null, status: "starting", orchUrl: null },
};

/** Connecting — IPC channel hasn't reported a status yet; fallback render. */
export const Connecting: Story = {
  args: { statusError: null, status: "unknown", orchUrl: null },
};

/** Error — IPC handler set statusError; rendered in destructive color. */
export const ErrorState: Story = {
  args: { statusError: "spawn EACCES", status: "error", orchUrl: null },
};
