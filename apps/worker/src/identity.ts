import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "pathe";
import { z } from "zod";

const UuidSchema = z.uuid();

/**
 * Read the worker's persistent identity from disk, or generate + persist a
 * fresh UUID v4 if no identity file exists yet. The same UUID is then used
 * for the worker's lifetime across restarts — re-registration is detected
 * by the orchestrator as upsert-by-id.
 *
 * @param path - absolute path to the identity file. Parent directories are
 * created as needed.
 * @returns the worker's identity UUID
 * @throws {ZodError} if the file exists but its content is not a valid UUID
 * (corruption signal — surface loudly rather than silently re-issue a new id)
 */
export function loadOrCreateIdentity(path: string): string {
  if (existsSync(path)) {
    const content = readFileSync(path, "utf8").trim();
    return UuidSchema.parse(content);
  }
  const id = randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, id, "utf8");
  return id;
}
