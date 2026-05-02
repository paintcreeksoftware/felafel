import { resolve } from "pathe";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@felafel/db": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
