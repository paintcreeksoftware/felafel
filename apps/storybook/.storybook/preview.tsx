// Storybook preview — global decorators + parameters applied to every story.
// The `globals.css` import has to come BEFORE any component import so the
// Tailwind v4 `@theme` + `@layer base` directives register before any class
// is resolved by a rendered component. Mirrors how
// apps/desktop/src/renderer/src/main.tsx imports the same file.
import "@felafel/ui/styles/globals.css";

import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(?:background|color)$/u, date: /Date$/u } },
  },
};

export default preview;
