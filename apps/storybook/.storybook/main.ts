// Storybook framework + stories glob. React-Vite renderer; type-checking
// stays the responsibility of `pnpm check-types` (i.e. `tsc --noEmit`) so
// we keep Storybook's per-story type-check off — running it twice would
// just double the boot time without catching anything new.
//
// `viteFinal` aliases `@felafel/desktop` → `apps/desktop/src/renderer/src/`
// so Storybook can import renderer components (PAI-190). Desktop's own
// `electron.vite.config.ts` does the same alias for its renderer build;
// this mirrors it so the same import strings resolve in both surfaces.
import type { StorybookConfig } from "@storybook/react-vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../src/stories/**/*.stories.@(ts|tsx)"],
  addons: [],
  typescript: { check: false },
  // eslint-disable-next-line @typescript-eslint/require-await -- Storybook's `viteFinal` signature is declared async; returning a sync value is the documented pattern.
  async viteFinal(viteConfig) {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      "@felafel/desktop": resolve(HERE, "../../desktop/src/renderer/src"),
    };
    return viteConfig;
  },
};

export default config;
