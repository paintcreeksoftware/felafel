import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { loadOrCreateIdentity } from "@felafel/worker/identity";

describe("loadOrCreateIdentity", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worker-identity-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates a UUID when the file is missing", () => {
    const path = join(dir, "id");
    const id = loadOrCreateIdentity(path);
    expect(id).toMatch(/^[0-9a-f-]{36}$/iu);
  });

  it("returns the same UUID across calls", () => {
    const path = join(dir, "id");
    const first = loadOrCreateIdentity(path);
    const second = loadOrCreateIdentity(path);
    expect(second).toBe(first);
  });

  it("creates parent directories as needed", () => {
    const path = join(dir, "nested", "subdir", "id");
    const id = loadOrCreateIdentity(path);
    expect(id).toMatch(/^[0-9a-f-]{36}$/iu);
  });

  it("throws when the file content is not a UUID", () => {
    const path = join(dir, "id");
    writeFileSync(path, "not-a-uuid", "utf8");
    expect(() => loadOrCreateIdentity(path)).toThrow();
  });
});
