// Drizzle table definitions — the source of truth for Felafel's persistence
// layer. Two consumers:
//
// 1. @felafel/db imports these to construct the SQLite client and query
//    functions, and lets drizzle-kit auto-generate migration SQL from them.
// 2. ./zod.ts (in this package) feeds them through drizzle-zod to derive
//    wire schemas, which @felafel/shared re-exports for non-DB consumers.
//
// No driver is imported here — the schema is dialect-decoupled at runtime,
// and only the SQLite-core column builders come in. The runtime driver
// (node:sqlite, after PAI-103) lives in @felafel/db so the worker daemon
// and Electron renderer (which consume @felafel/shared) don't transitively
// touch it.

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const nowSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/**
 * Uniform columns applied to every table. Spread first in each table
 * definition so they occupy column ordinal positions 0 and 1 in the
 * generated `CREATE TABLE` statement.
 *
 * - `id`: integer PK, auto-increment. DB-internal identity, never exposed
 *   on the wire. External/business identifiers (UUIDs from a wire contract,
 *   identifiers assigned by a daemon) live in their own column with
 *   `UNIQUE NOT NULL`.
 * - `createdAt`: insert time, ISO 8601 UTC, set via SQL default.
 *
 * No `updatedAt` — Drizzle's `$onUpdate` only fires for Drizzle-mediated
 * writes, so it would silently lie under raw SQL writes (db:studio edits,
 * sqlite3 CLI sessions). A half-truth column is worse than no column.
 * Domain-specific timestamps (`lastSeenAt`, `dispatchedAt`, `completedAt`)
 * carry the meaningful "last touched" information that callers actually use.
 */
const baseColumns = {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull().default(nowSql),
};

/**
 * Workers known to the orchestrator.
 *
 * Wire identity (`workerId`) is the UUID the worker daemon presents in its
 * registration payload — it lives in its own column with `UNIQUE NOT NULL`
 * so DB row identity (the integer PK) and business identity stay separate.
 * The conversion layer in `@felafel/db` translates `row.workerId` back to the
 * wire's `id` field at the orchestrator boundary.
 *
 * `os` and `arch` are constrained to Node's `process.platform` /
 * `process.arch` values respectively; SQLite renders these as `CHECK`
 * constraints, and the wire schema in `./zod.ts` mirrors them via the
 * same enum union.
 *
 * `status` is server-managed: set to `"active"` on every (re-)registration,
 * flipped to `"stale"` by the periodic sweep when `lastSeenAt` is older
 * than the heartbeat-miss threshold.
 */
export const workers = sqliteTable("workers", {
  ...baseColumns,
  workerId: text("worker_id").notNull().unique(),
  hostname: text("hostname").notNull(),
  tailscaleName: text("tailscale_name"),
  os: text("os", { enum: ["linux", "darwin", "win32"] }),
  arch: text("arch", { enum: ["x64", "arm64"] }),
  version: text("version"),
  // JSON-stringified at the DB layer (SQLite has no JSON column type that
  // helps us round-trip nested objects); the wire schema carries the parsed
  // record. The @felafel/db conversion layer handles JSON.parse / stringify.
  labels: text("labels"),
  controlPlaneUrl: text("control_plane_url").notNull(),
  status: text("status", { enum: ["active", "stale"] })
    .notNull()
    .default("active"),
  registeredAt: text("registered_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

/**
 * Job runs dispatched to workers and tracked through their lifecycle:
 * `pending` → `dispatched` → (`complete` | `failed`).
 *
 * Same row vs wire identity split as `workers` — the server-assigned UUID
 * lives in `runId`, exposed as `id` on the wire (e.g. in the
 * `POST /runs/:id/complete` URL).
 *
 * `workerId` is a foreign key to `workers.workerId` (the wire UUID, not the
 * integer PK) because dispatch logic naturally knows the worker UUID and
 * doesn't translate to the integer. With default `ON DELETE NO ACTION` —
 * workers are never deleted, only marked stale — there's no cascade story
 * to design.
 *
 * `runs_created_at` index supports the canonical "newest runs first"
 * listing on `GET /runs`. Clock time is the right ordering key for a job
 * queue regardless of any future distribution.
 */
export const runs = sqliteTable(
  "runs",
  {
    ...baseColumns,
    runId: text("run_id").notNull().unique(),
    payload: text("payload").notNull(),
    status: text("status", {
      enum: ["pending", "dispatched", "complete", "failed"],
    }).notNull(),
    workerId: text("worker_id").references(() => workers.workerId),
    error: text("error"),
    dispatchedAt: text("dispatched_at"),
    completedAt: text("completed_at"),
  },
  (table) => [index("runs_created_at").on(sql`${table.createdAt} DESC`)],
);
