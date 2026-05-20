// Input has no `cva` variants — one canonical story showing the
// default chrome (border, focus ring, placeholder color). Reviewers
// catch drift on the focus/placeholder treatment via snapshot.
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "@felafel/ui/components/ui/input";

const meta = {
  title: "Primitives/Input",
  component: Input,
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default — placeholder visible, neutral border. */
export const Default: Story = {
  args: { placeholder: "tskey-auth-..." },
};
