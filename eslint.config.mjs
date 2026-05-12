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
      "max-params": ["error", 5],
      "max-statements": ["error", { max: 30 }],
      "complexity": ["error", { max: 20 }],
      // Core — Suggestions / identifier naming
      // The "what an identifier can be named" cluster. The on rules
      // catch cheap-to-enforce conventions; the off rules are either
      // covered by TS or too prescriptive for real code.
      "camelcase": ["error", { properties: "never", ignoreDestructuring: false, ignoreImports: false, ignoreGlobals: false }],
      "capitalized-comments": "off", // single-line clarifications and TODO/FIXME refs aren't always sentences
      "consistent-this": "off", // `const self = this` is rare in TS
      "func-name-matching": "error",
      "func-names": "off", // anonymous arrow functions are everywhere; the stack-trace cost isn't worth the noise
      "func-style": "off", // both declarations and arrow expressions used freely in this codebase
      "id-denylist": "off", // no project-specific identifier bans defined yet
      "id-length": "off", // `i`, `j`, `e` (event) valid in narrow scopes
      "id-match": "off", // too prescriptive; no project regex pattern defined
      "new-cap": "error",
      "no-underscore-dangle": "error",
      // Core — Suggestions / control flow + early-return
      // Rules that shape how branches and returns are written.
      "block-scoped-var": "error",
      "consistent-return": "error",
      "curly": ["error", "all"],
      "default-case": "error",
      "default-case-last": "error",
      "default-param-last": "error",
      "dot-notation": "error",
      "eqeqeq": ["error", "always"],
      "guard-for-in": "error",
      "no-case-declarations": "error",
      "no-else-return": "error",
      "no-lonely-if": "error",
      "no-loop-func": "error",
      "no-negated-condition": "off",
      "no-nested-ternary": "error",
      "no-return-assign": ["error", "always"],
      "no-ternary": "off",
      "no-unneeded-ternary": ["error", { defaultAssignment: false }],
      "yoda": ["error", "never"],
      // Core — Suggestions / forbid syntax (no-*)
      // Rules that reject specific syntax. Most are bug-finders worth
      // having on; the off cases are syntactic patterns we explicitly
      // want to keep using.
      // TODO(PAI-145): https://linear.app/paint-creek-software/issue/PAI-145
      //   `window.confirm` in App.tsx's worker-forget flow needs a
      //   React Dialog refactor; flip this rule to error in the same PR.
      "no-array-constructor": "error",
      "no-bitwise": "off",
      "no-caller": "error",
      "no-console": "off",
      "no-continue": "off",
      "no-delete-var": "error",
      "no-div-regex": "error",
      "no-empty": "error",
      "no-empty-function": "error",
      "no-empty-static-block": "error",
      "no-eq-null": "error",
      "no-eval": "error",
      "no-extend-native": "error",
      "no-extra-bind": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-iterator": "error",
      "no-multi-str": "error",
      "no-octal": "error",
      "no-octal-escape": "error",
      "no-proto": "error",
      "no-with": "error",
      "no-new": "error",
      "no-new-wrappers": "error",
      "no-object-constructor": "error",
      "no-useless-call": "error",
      "no-useless-catch": "error",
      "no-useless-computed-key": "error",
      "no-useless-concat": "error",
      "no-useless-constructor": "error",
      "no-useless-escape": "error",
      "no-useless-rename": "error",
      "no-useless-return": "error",
      "no-extra-label": "error",
      "no-label-var": "error",
      "no-labels": "error",
      "no-unused-labels": "error",
      "no-param-reassign": "error",
      "no-redeclare": "error",
      "no-shadow": "error",
      "no-shadow-restricted-names": "error",
      "no-extra-boolean-cast": "error",
      "no-implicit-coercion": "error",
      "no-implicit-globals": "error",
      "no-invalid-this": "error",
      "no-throw-literal": "error",
      "no-nonoctal-decimal-escape": "error",
      "no-undef-init": "error",
      "no-var": "error",
      "no-inline-comments": "off",
      "no-plusplus": "off",
      "no-undefined": "off",
      "no-void": "off",
      "no-warning-comments": "off",
      // TODO(PAI-141 batch 2: core - Suggestions; continuing forbid syntax).
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
  {
    // Test-file overrides — mirrors the `.oxlintrc.json` overrides
    // section. Empty arrow functions are a standard test idiom
    // (`mockImplementation(() => {})`, stream `.on("data", () => {})`).
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/*.integration.test.ts"],
    rules: {
      "no-empty-function": "off",
    },
  },
];

export default config;
