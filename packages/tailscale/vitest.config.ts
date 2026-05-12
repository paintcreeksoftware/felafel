// Vitest config for @felafel/tailscale. Mixed surface — the node-side
// classifiers + manager have always been tested with vitest's default
// node environment, but the renderer-side UI components (StatusBadge,
// MissingBinaryTooltip, Pill) need a DOM. Resolved with two test
// projects so each file gets the right environment without slowing
// the node-side suite with happy-dom's bootstrap.
import { resolve } from "pathe";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@felafel/tailscale": resolve(__dirname, "src") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          // Node-side: every .test.ts EXCEPT the ones inside src/ui/.
          include: ["src/**/*.test.ts"],
          exclude: ["src/ui/**/*"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "happy-dom",
          include: ["src/ui/**/*.test.tsx"],
        },
      },
    ],
  },
});
