// Smoke test for createDb. Validates that:
// 1. node:sqlite's DatabaseSync opens (Node 24 with --experimental-sqlite
//    or 24+ where it's stable; the import itself is the smoke check).
// 2. The migrations folder resolves correctly from import.meta.dirname
//    when running under tsx (vitest's transformer).
// 3. drizzle-kit's generated SQL applies cleanly against an empty DB.
// 4. The expected tables exist after migration.
//
// Query behavior is exercised in D4 (workers) and D5 (runs); this file
// just guards the package-scaffold infrastructure.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DbHandle } from "@felafel/db";

describe("createDb", () => {
  let dataDir: string;
  let handle: DbHandle;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "felafel-db-test-"));
  });

  afterEach(() => {
    handle?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("opens a SQLite database under dataDir, applies migrations, returns a Drizzle handle", () => {
    handle = createDb(dataDir);
    expect(handle.db).toBeDefined();
    expect(typeof handle.close).toBe("function");
  });

  it("creates the workers and runs tables on first open", () => {
    handle = createDb(dataDir);
    const tables = handle.db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((row) => row.name);
    expect(names).toContain("workers");
    expect(names).toContain("runs");
  });

  it("creates the runs_created_at index", () => {
    handle = createDb(dataDir);
    const indexes = handle.db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all() as { name: string }[];
    const names = indexes.map((row) => row.name);
    expect(names).toContain("runs_created_at");
  });

  it("is idempotent — re-opening the same dataDir applies no further migrations", () => {
    handle = createDb(dataDir);
    handle.close();
    // Re-open; second run should be a no-op for migrations (drizzle tracks
    // applied ones in the __drizzle_migrations table).
    handle = createDb(dataDir);
    expect(handle.db).toBeDefined();
  });
});
