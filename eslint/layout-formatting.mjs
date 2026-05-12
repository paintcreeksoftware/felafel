// Layout & Formatting rule cluster for the PAI-141 oxlint → ESLint
// cutover. Extracted from `eslint.config.mjs` so that file stays
// under the 300-line max-lines cap; the 70 entries below are spread
// in via `...LAYOUT_FORMATTING_RULES` at the layout-formatting
// section of the rule list.
//
// ALL OFF. oxfmt owns formatting in this project — running both
// would mean two formatters fighting each other. These rules are
// also deprecated upstream (moved to @stylistic/eslint-plugin), so
// even if any were ever needed, the modern home would be the right
// place, not the deprecated core entry.
//
// The cutover requirement "every rule must be specified" is what
// motivates enumerating them despite all being off — a future reader
// sees a deliberate "off" decision rather than wondering whether a
// rule was forgotten.

const RULES = [
  "array-bracket-newline",
  "array-bracket-spacing",
  "array-element-newline",
  "arrow-parens",
  "arrow-spacing",
  "block-spacing",
  "brace-style",
  "comma-dangle",
  "comma-spacing",
  "comma-style",
  "computed-property-spacing",
  "dot-location",
  "eol-last",
  "func-call-spacing",
  "function-call-argument-newline",
  "function-paren-newline",
  "generator-star-spacing",
  "implicit-arrow-linebreak",
  "indent",
  "indent-legacy",
  "jsx-quotes",
  "key-spacing",
  "keyword-spacing",
  "line-comment-position",
  "linebreak-style",
  "lines-around-comment",
  "lines-around-directive",
  "lines-between-class-members",
  "max-len",
  "max-statements-per-line",
  "multiline-comment-style",
  "multiline-ternary",
  "new-parens",
  "newline-per-chained-call",
  "no-extra-parens",
  "no-extra-semi",
  "no-floating-decimal",
  "no-mixed-operators",
  "no-mixed-spaces-and-tabs",
  "no-multi-spaces",
  "no-multiple-empty-lines",
  "no-tabs",
  "no-trailing-spaces",
  "no-whitespace-before-property",
  "nonblock-statement-body-position",
  "object-curly-newline",
  "object-curly-spacing",
  "object-property-newline",
  "operator-linebreak",
  "padded-blocks",
  "padding-line-between-statements",
  "quote-props",
  "quotes",
  "rest-spread-spacing",
  "semi",
  "semi-spacing",
  "semi-style",
  "space-before-blocks",
  "space-before-function-paren",
  "space-in-parens",
  "space-infix-ops",
  "space-unary-ops",
  "spaced-comment",
  "switch-colon-spacing",
  "template-curly-spacing",
  "template-tag-spacing",
  "unicode-bom",
  "wrap-iife",
  "wrap-regex",
  "yield-star-spacing",
];

export const LAYOUT_FORMATTING_RULES = Object.fromEntries(
  RULES.map((rule) => [rule, "off"]),
);
