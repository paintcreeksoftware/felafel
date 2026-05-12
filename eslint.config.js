// Scaffold eslint flat config for the oxlint → eslint cutover tracked in
// PAI-141. Intentionally enumerates every rule explicitly with no
// `extends` and no inherited preset, per the ticket's "no implicit
// recommended sets" requirement.
//
// All rules start `"off"`. Follow-up PRs in the PAI-141 stack flip rules
// on in cohesive batches (core, typescript, react, a11y, import,
// tailwindcss, jsdoc, unicorn). The motivating rule —
// `better-tailwindcss/no-unregistered-classes` — lands in the tailwindcss
// batch.
//
// Plugins are imported lazily / left as TODO comments until they're added
// as dev dependencies in their respective batch PRs, so this scaffold
// stays installable without pulling the whole ESLint ecosystem in one
// shot.

/** @type {import("eslint").Linter.Config[]} */
const config = [
  {
    // Repo-wide ignore patterns. Mirrors what oxlint currently skips.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/.turbo/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/coverage/**",
    ],
  },
  {
    // Catch-all block. Rules added per-batch in follow-up PRs.
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      // TODO(PAI-141 batch 1: core): enumerate every rule under
      //   https://eslint.org/docs/latest/rules/ with an explicit on/off.
      // TODO(PAI-141 batch 2: @typescript-eslint): enumerate every rule
      //   under https://typescript-eslint.io/rules/ .
      // TODO(PAI-141 batch 3: react + react-hooks + react-refresh).
      // TODO(PAI-141 batch 4: jsx-a11y).
      // TODO(PAI-141 batch 5: import-x).
      // TODO(PAI-141 batch 6: better-tailwindcss) — motivating plugin;
      //   no-unregistered-classes catches the Tailwind class typos that
      //   slipped past oxlint on PAI-138.
      // TODO(PAI-141 batch 7: jsdoc) — codify the TSDoc-by-default rule.
      // TODO(PAI-141 batch 8: unicorn).
    },
  },
];

export default config;
