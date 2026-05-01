import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@felafel/orchestrator": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
