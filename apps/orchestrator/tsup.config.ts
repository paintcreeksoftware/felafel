import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";

// esbuild strips the "node:" prefix from built-in imports during output
// (see https://github.com/evanw/esbuild/issues/2762). For modules with a
// legacy unprefixed alias (fs, path, etc) this is harmless; for node:sqlite
// it breaks at runtime because there is no top-level "sqlite" module. We
// restore the prefix in an onSuccess step rather than fight esbuild's
// resolver. ESM output keeps the import literal so a regex rewrite is safe.
const NODE_BUILTINS_NEEDING_PREFIX = ["sqlite"];

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node24",
  outDir: "dist",
  clean: true,
  platform: "node",
  onSuccess: async () => {
    const path = "dist/index.js";
    let src = readFileSync(path, "utf-8");
    for (const name of NODE_BUILTINS_NEEDING_PREFIX) {
      src = src.replace(
        new RegExp(`from\\s+"${name}"`, "g"),
        `from "node:${name}"`,
      );
    }
    writeFileSync(path, src);
  },
});
