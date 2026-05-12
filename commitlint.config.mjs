// Named const before `export default` so oxlint's
// `import/no-anonymous-default-export` rule passes when this file is
// linted alongside the rest of the repo's root-level .mjs files.
const config = {
  extends: ["@commitlint/config-conventional"],
};

export default config;
