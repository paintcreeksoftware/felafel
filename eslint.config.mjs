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
      // Core — Possible Problems
      // https://eslint.org/docs/latest/rules/#possible-problems
      // Bug-finders from ESLint core. The off cases either duplicate
      // TypeScript's own checks, are superseded by a typed analog in a
      // later batch, or are deprecated by ESLint itself.
      "array-callback-return": "error",
      "constructor-super": "error",
      "for-direction": "error",
      "getter-return": "error",
      "no-async-promise-executor": "error",
      "no-await-in-loop": "off", // sequential awaits are sometimes intentional
      "no-class-assign": "error",
      "no-compare-neg-zero": "error",
      "no-cond-assign": "error",
      "no-const-assign": "error",
      "no-constant-binary-expression": "error",
      "no-constant-condition": "error",
      "no-constructor-return": "error",
      "no-control-regex": "error",
      "no-debugger": "error",
      "no-dupe-args": "error",
      "no-dupe-class-members": "off", // TS catches; would also break valid overload signatures
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-duplicate-imports": "off", // batch 5 import-x/no-duplicates is type-aware
      "no-empty-character-class": "error",
      "no-empty-pattern": "error",
      "no-ex-assign": "error",
      "no-fallthrough": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-inner-declarations": "error",
      "no-invalid-regexp": "error",
      "no-irregular-whitespace": "error",
      "no-loss-of-precision": "error",
      "no-misleading-character-class": "error",
      "no-new-native-nonconstructor": "error",
      "no-obj-calls": "error",
      "no-promise-executor-return": "error",
      "no-prototype-builtins": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-setter-return": "error",
      "no-sparse-arrays": "error",
      "no-template-curly-in-string": "error",
      "no-this-before-super": "error",
      "no-undef": "off", // TS resolver handles undefined identifiers
      "no-unexpected-multiline": "off", // deprecated; oxfmt owns formatting
      "no-unmodified-loop-condition": "error",
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",
      "no-unused-private-class-members": "error",
      "no-unused-vars": "off", // batch 4 @typescript-eslint/no-unused-vars supersedes
      "no-use-before-define": "off", // batch 4 @typescript-eslint/no-use-before-define supersedes
      "no-useless-assignment": "error",
      "no-useless-backreference": "error",
      "require-atomic-updates": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      // Core — Suggestions / complexity + LOC caps
      // https://eslint.org/docs/latest/rules/#suggestions
      // Enabled as the canonical 300-line cap enforcer (retires
      // PAI-140's custom `scripts/check-file-length.sh` ratchet).
      // skipBlankLines + skipComments because TSDoc + comments + spacing
      // are not what reviewers are counting; reviewable code is what
      // matters.
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-classes-per-file": ["error", 1],
      "max-depth": ["error", 4],
      "max-lines-per-function": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
      "max-nested-callbacks": ["error", 10],
      // TODO(PAI-141 batch 2: core - Suggestions).
      // TODO(PAI-141 batch 3: core - Layout & Formatting; expected all off
      //   since oxfmt owns formatting, but enumerated explicitly per the
      //   "every rule must be specified" cutover rule).
      // TODO(PAI-141 batch 4: @typescript-eslint). Plugin install lands
      //   with that batch.
      // TODO(PAI-141 batch 5: react + react-hooks + react-refresh).
      // TODO(PAI-141 batch 6: jsx-a11y).
      // TODO(PAI-141 batch 7: import-x).
      // TODO(PAI-141 batch 8: better-tailwindcss) — motivating plugin;
      //   no-unregistered-classes catches the Tailwind class typos
      //   that slipped past oxlint on PAI-138.
      // TODO(PAI-141 batch 9: jsdoc) — codify the TSDoc-by-default
      //   project rule as a tool check.
      // TODO(PAI-141 batch 10: unicorn).
      // TODO(PAI-141 batch 11: cutover — drop oxlint, .oxlintrc.json,
      //   per-package "lint" scripts, root "lint" → alias to lint:eslint.
      //   oxfmt stays.
    },
  },
];

export default config;
