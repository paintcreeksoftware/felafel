// Scaffold eslint flat config for the oxlint → eslint cutover tracked
// in PAI-141. Intentionally enumerates rules explicitly with no
// `extends` and no inherited preset, per the ticket's "no implicit
// recommended sets" requirement.
//
// PR 1 (this file) wires up the TS parser and the file globs only —
// every rule starts implicitly off. Follow-up PAI-141_N batch PRs flip
// rules on in cohesive batches (core, typescript, react, a11y, import,
// tailwindcss, jsdoc, unicorn). The motivating rule —
// `better-tailwindcss/no-unregistered-classes` — lands in the
// tailwindcss batch.
//
// Plugins beyond `typescript-eslint/parser` are added in their batch
// PRs so this scaffold stays installable without pulling the whole
// ESLint ecosystem in one shot.
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  {
    // Repo-wide ignore patterns. Mirrors what oxlint currently skips
    // (`packages/ui/**` via `.oxlintrc.json#ignorePatterns`) plus the
    // standard build-output / coverage / test-artifact globs.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/.turbo/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/coverage/**",
      "packages/ui/**",
    ],
  },
  {
    // TypeScript surface: every workspace's source + test trees + the
    // few root-level .{m,c}js scripts.
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // TODO(PAI-141 batch 1: core): enumerate every rule under
      //   https://eslint.org/docs/latest/rules/ with an explicit on/off.
      // TODO(PAI-141 batch 2: @typescript-eslint): enumerate every rule
      //   under https://typescript-eslint.io/rules/ . Add the plugin
      //   here once installed.
      // TODO(PAI-141 batch 3: react + react-hooks + react-refresh).
      // TODO(PAI-141 batch 4: jsx-a11y).
      // TODO(PAI-141 batch 5: import-x).
      // TODO(PAI-141 batch 6: better-tailwindcss) — motivating plugin;
      //   no-unregistered-classes catches the Tailwind class typos
      //   that slipped past oxlint on PAI-138.
      // TODO(PAI-141 batch 7: jsdoc) — codify the TSDoc-by-default
      //   project rule as a tool check.
      // TODO(PAI-141 batch 8: unicorn).
    },
  },
];

export default config;
