// drizzle-kit reads this to know where the schema lives and where to write
// the generated SQL. The schema source-of-truth lives in @felafel/contracts;
// drizzle-kit doesn't resolve workspace aliases, so we point at the file
// path directly. Migrations land under ./migrations/, committed alongside
// the package.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "../contracts/src/schema.ts",
  out: "./migrations",
});
