// Vitest config — discovers `*.test.ts` next to source for unit tests, plus
// `*.integration.test.ts` for the heavier suite that spawns a real PocketBase.
// Two scripts in package.json target each via --include / --exclude.
//
// Coverage gate is set to 1 (any positive coverage passes). Bump these
// numbers as the test suite grows; the gate is wired so the bump is a
// one-line change rather than new infrastructure.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    // E2E lives under tests/e2e/ and is run by Playwright, not Vitest.
    exclude: ["**/node_modules/**", "out/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
      thresholds: {
        lines: 1,
        functions: 1,
        branches: 1,
        statements: 1,
      },
    },
  },
});
