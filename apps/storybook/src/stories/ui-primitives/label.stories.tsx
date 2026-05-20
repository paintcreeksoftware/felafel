// Label has no `cva` variants (the cva call has no `variants:` field) —
// one canonical story pinning the text size / weight / disabled
// pairing.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Label } from "@felafel/ui/components/ui/label";

const meta = {
  title: "Primitives/Label",
  component: Label,
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — the only render path. Form-field label, sits above input. */
export const Default: Story = {
  args: { htmlFor: "example-input", children: "Pre-auth key" },
};
