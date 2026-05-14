import { resolve } from "pathe";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@felafel/logs": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
  },
});
