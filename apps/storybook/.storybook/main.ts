// Storybook framework + stories glob. React-Vite renderer; type-checking
// stays the responsibility of `pnpm check-types` (i.e. `tsc --noEmit`) so
// we keep Storybook's per-story type-check off — running it twice would
// just double the boot time without catching anything new.
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../src/stories/**/*.stories.@(ts|tsx)"],
  addons: [],
  typescript: { check: false },
};

export default config;
