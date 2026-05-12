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
import pluginBetterTailwindcss from "eslint-plugin-better-tailwindcss";
import { flatConfigs as importXFlatConfigs } from "eslint-plugin-import-x";
import pluginJsdoc from "eslint-plugin-jsdoc";
import pluginJsxA11y from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { LAYOUT_FORMATTING_RULES } from "./eslint/layout-formatting.mjs";

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
      "no-global-assign": "error",
      "no-lone-blocks": "error",
      "no-multi-assign": "error",
      "no-regex-spaces": "error",
      "no-sequences": "error",
      "no-unused-expressions": "error",
      // Core — Suggestions / modern-syntax push (prefer-* / require-*)
      // Rules that prefer the modern alternative when one exists.
      "prefer-arrow-callback": "error",
      "prefer-const": "error",
      "prefer-destructuring": "error",
      "prefer-exponentiation-operator": "error",
      "prefer-named-capture-group": "error",
      "prefer-numeric-literals": "error",
      "prefer-object-has-own": "error",
      "prefer-object-spread": "error",
      "prefer-promise-reject-errors": "error",
      "prefer-regex-literals": "error",
      "prefer-rest-params": "error",
      "prefer-spread": "error",
      "prefer-template": "error",
      "require-await": "error",
      "require-unicode-regexp": "error",
      "require-yield": "error",
      "arrow-body-style": ["error", "as-needed"],
      "object-shorthand": ["error", "always"],
      "operator-assignment": ["error", "always"],
      "logical-assignment-operators": ["error", "always"],
      "radix": ["error", "always"],
      "symbol-description": "error",
      "accessor-pairs": "error",
      "grouped-accessor-pairs": "error",
      "one-var": ["error", "never"],
      "strict": ["error", "never"],
      "vars-on-top": "error",
      // Core — Suggestions / restricted-* (project-specific bans)
      // Each entry is researched against the codebase + cross-referenced
      // with its prefer-* twin (when one exists) so the ban is
      // enforceable, not theoretical. oxlint implements all five via
      // `eslint/no-restricted-*`; flipping them on in ESLint matches
      // the existing oxlint coverage with project-tuned defaults.
      "no-restricted-exports": ["error", {
        // Exporting a member named `then` makes the module thenable
        // under dynamic `import()`, silently triggering its await.
        // Silent foot-gun; never intentional.
        restrictedNamedExports: ["then"],
      }],
      "no-restricted-globals": ["error",
        // Browser `Window` globals that look like locals but shadow
        // real identifiers. The bare references compile clean and
        // resolve to `window.<x>` only in browser contexts — flagging
        // them forces an explicit `window.` or a real local binding.
        { name: "event", message: "Use the event parameter from the handler, not the global." },
        { name: "name", message: "window.name leaks into globals; use a local binding." },
        { name: "top", message: "window.top is rarely what you want; use the local scope." },
        { name: "parent", message: "window.parent is for iframes; use the local scope." },
        { name: "external", message: "window.external is non-standard." },
        { name: "closed", message: "window.closed is non-standard." },
        { name: "find", message: "window.find is the browser search box; use Array.prototype.find." },
      ],
      "no-restricted-imports": ["error", {
        // Project rule (memory: no-relative-imports). Carve-outs for
        // window.ts (Vite `?asset` query) + test fixtures are handled
        // by the file-level overrides at the bottom of this file.
        patterns: [
          { group: ["./*", "../*"], message: "Use the @felafel/<pkg>/... alias, not relative paths." },
          { group: ["*.js"], message: "Drop the .js extension; bundler resolution handles it." },
        ],
      }],
      "no-restricted-properties": ["error",
        // Twins of `prefer-exponentiation-operator` and
        // `prefer-object-has-own` that catch the bracketed-access /
        // variable-reference shapes those rules don't see.
        //
        // Deliberately omitted: `Object.assign`. The prefer-object-spread
        // rule already catches the common case (`Object.assign({}, …)`
        // → `{...a, ...b}`). The remaining `Object.assign(existingObj, …)`
        // form is the canonical Error-decoration idiom used by
        // `ServeFailureError` in packages/tailscale — direct mutation
        // would be no better and three lines longer.
        { object: "Math", property: "pow", message: "Use the `**` operator (also enforced by prefer-exponentiation-operator)." },
        { property: "hasOwnProperty", message: "Use Object.hasOwn(obj, prop) (also enforced by prefer-object-has-own)." },
      ],
      // Core — Suggestions / sort + ordering
      // All three off. None of them earns a place at the cost of
      // forcing alphabetical reorderings over the semantic shapes the
      // codebase prefers; oxlint cross-reference below.
      //   - sort-imports: superseded by `import-x/order` (added in
      //     the upcoming import-x plugin batch), which understands
      //     side-effect-only, type-only, and bare specifier shapes.
      //     oxlint has it off too.
      //   - sort-keys: object keys are routinely grouped semantically
      //     (`id`, `createdAt`, `updatedAt` first; configuration keys
      //     by section; discriminated-union tag first). Alphabetical
      //     would obscure that. oxlint has it off too.
      //   - sort-vars: redundant with `one-var: never` above —
      //     multi-declaration `let a, b` is already a hard error, so
      //     there's nothing left to sort. oxlint marks it "under
      //     development"; not waiting on it.
      "sort-imports": "off",
      "sort-keys": "off",
      "sort-vars": "off",
      "no-restricted-syntax": ["error",
        // Two project bans, both currently non-regressing (codebase
        // scan found zero matches), so this is a lockdown not a
        // refactor: enums (enum-merging + reverse mappings hurt
        // bundle-time analyzability; we use `Platform` / `EnvVars`
        // const-objects instead) and `export let` (mutable exports
        // defeat import-side reasoning).
        { selector: "TSEnumDeclaration", message: "Use a `const` object with `as const` instead of an enum — keeps the runtime shape predictable and matches the `Platform` / `EnvVars` pattern." },
        { selector: "ExportNamedDeclaration > VariableDeclaration[kind='let']", message: "Export `const`, not `let`. A mutable export defeats import-side reasoning." },
      ],
      // Core — Layout & Formatting (https://eslint.org/docs/latest/rules/#layout--formatting)
      // ALL OFF — oxfmt owns formatting in this project; the 70 rules
      // are enumerated in `eslint/layout-formatting.mjs` and spread in
      // here as a single statement to keep this file under the
      // max-lines cap.
      ...LAYOUT_FORMATTING_RULES,
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
    // Test fixtures (e.g. `./helpers/fake-worker.ts`) are colocated
    // with the test file by convention and don't go through a
    // workspace alias.
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/*.integration.test.ts"],
    rules: {
      "no-empty-function": "off",
      "no-restricted-imports": "off",
    },
  },
  {
    // `apps/desktop/src/main/window.ts` inlines the app icon via Vite's
    // `?asset` query, which is a relative-path import by construction
    // (the bundler resolves `?asset` against the build/ directory at
    // build time — there's no workspace-alias form).
    files: ["apps/desktop/src/main/window.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // Root-level lint config files. The root package isn't a
    // `@felafel/<pkg>` workspace member, so there's no alias form to
    // import the extracted rule-cluster modules in `eslint/` — the
    // import has to be relative. Also exempt from the file-length
    // caps: a lint config that enumerates rule clusters for 9 plugins
    // is legitimately longer than 300 lines, and "split this file"
    // doesn't make a lint config easier to reason about.
    files: ["eslint.config.mjs", "eslint/**/*.mjs"],
    rules: {
      "no-restricted-imports": "off",
      "max-lines": "off",
    },
  },
  // ──────────────────────────────────────────────────────────────────
  // Plugin tier (PAI-141 batches 4-10). Each plugin is wired up with
  // its `recommended` preset + targeted overrides — that's the
  // conventional ESLint flow and is honest about who owns the rule
  // curation (the plugin authors, not us). The "every rule must be
  // specified" requirement applies to the core-rules layer above; for
  // plugins we trust the recommended preset and document only the
  // overrides.
  // ──────────────────────────────────────────────────────────────────
  // @typescript-eslint — non-type-aware recommended. The type-aware
  // tier (`recommendedTypeChecked`) is deferred to a follow-up PR
  // because it needs tsconfig surgery (the auto-discovered project
  // service doesn't see every .ts file under the current layout) and
  // surfaces ~80 real violations we'd want to fix one-by-one, which
  // is its own scoped change.
  ...tseslint.configs.recommended,
  // React family: react + react-hooks + react-refresh. Scoped to
  // **/*.{jsx,tsx} via the `files` field — the orchestrator + worker
  // are pure Node code, no JSX. New-JSX-transform project (no
  // `import React` at top of every file), so `jsx-runtime` config is
  // layered after `recommended` to turn off `react/react-in-jsx-scope`.
  {
    files: ["**/*.{jsx,tsx}"],
    ...pluginReact.configs.flat.recommended,
  },
  {
    files: ["**/*.{jsx,tsx}"],
    ...pluginReact.configs.flat["jsx-runtime"],
  },
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { "react-hooks": pluginReactHooks },
    rules: pluginReactHooks.configs.recommended.rules,
  },
  {
    files: ["**/*.{jsx,tsx}"],
    ...pluginReactRefresh.configs.vite,
  },
  // jsx-a11y — accessibility checks on JSX. Scoped to JSX/TSX. The
  // plugin's `flatConfigs.recommended` is the curated subset that
  // catches real accessibility issues without becoming noise.
  {
    files: ["**/*.{jsx,tsx}"],
    ...pluginJsxA11y.flatConfigs.recommended,
  },
  // import-x — import correctness. We use `flatConfigs.recommended`
  // for the bug-catcher rules (no-duplicates, no-self-import,
  // no-cycle, etc.) but turn off `import-x/no-unresolved`: TypeScript
  // already reports unresolved imports via `tsc --noEmit`, and
  // import-x's TS-aware resolver has a version-skew bug right now
  // ("typescript with invalid interface loaded as resolver"). Letting
  // TS own resolution checks avoids the duplicate config and the
  // resolver compat headache.
  importXFlatConfigs.recommended,
  {
    rules: {
      "import-x/no-unresolved": "off",
    },
  },
  // better-tailwindcss — the motivating plugin for the PAI-141
  // cutover. `no-unknown-classes` catches Tailwind class typos that
  // oxlint missed on PAI-138. Tailwind v4 CSS-first setup means the
  // plugin gets pointed at the v4 entry CSS via `settings.entryPoint`
  // instead of a tailwind.config.{js,ts} (which doesn't exist in v4).
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { "better-tailwindcss": pluginBetterTailwindcss },
    settings: {
      "better-tailwindcss": {
        entryPoint: "packages/ui/src/styles/globals.css",
      },
    },
    rules: {
      ...pluginBetterTailwindcss.configs["recommended-error"].rules,
      // Stylistic; class-string wrapping is a personal preference
      // and the rule's default wraps eagerly enough to push some
      // existing components past the max-lines-per-function cap.
      "better-tailwindcss/enforce-consistent-line-wrapping": "off",
    },
  },
  // jsdoc — codifies the "TSDoc by default" project memory rule as
  // a tool check. The `flat/recommended-tsdoc-error` preset uses the
  // TSDoc syntax dialect (matches what TypeScript itself parses, and
  // what's documented in the project's TSDoc-by-default rule).
  pluginJsdoc.configs["flat/recommended-tsdoc-error"],
  {
    rules: {
      // Recommended-tsdoc preset's strictest rules — too aggressive
      // for the codebase's current TSDoc coverage. The "TSDoc by
      // default" memory rule is about discipline for new code, not
      // retrofitting every existing function in one batch.
      //   - require-returns / require-param-description: many
      //     existing TSDoc blocks describe what the function does
      //     without separately spelling out each @returns and @param.
      //     Forcing the fill-in is hundreds of touch points and adds
      //     little signal.
      //   - escape-inline-tags: the rule misfires on the project's
      //     own `@felafel/*` import paths inside TSDoc comments,
      //     which aren't tags.
      "jsdoc/require-returns": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/escape-inline-tags": "off",
    },
  },
];

export default config;
