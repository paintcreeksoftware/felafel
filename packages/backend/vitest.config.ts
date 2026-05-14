import { resolve } from "pathe";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@felafel/backend": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
  },
});
