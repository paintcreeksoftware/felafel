---
description: Generate a Drizzle migration with a descriptive --name (rejects the <adjective>_<noun> defaults)
argument-hint: <descriptive_snake_case_name>
---

Generate a SQL migration via Drizzle, but enforce the project's
naming convention: descriptive `snake_case`, never Drizzle's default
`<adjective>_<noun>` (e.g. `nervous_polaris`). The defaults say
nothing about the actual schema change and rot the migrations folder.

1. **Confirm the name with the user before running**:
   - Is `$ARGUMENTS` accurately descriptive? Good examples:
     `workers_add_tailnet_serve_port`,
     `runs_drop_legacy_state_column`,
     `add_runs_dispatched_at_index`.
     Bad examples (reject): `nervous_polaris`, `update_schema`,
     `migration_1`, `fix_stuff`.
   - Is the format `snake_case`, not kebab-case, not camelCase?
   - Does it convey what the migration does (table_action_target)?
2. **If the name is good, run**:

   ```bash
   pnpm --filter @felafel/db db:generate --name $ARGUMENTS
   ```

3. **After generation**: read the produced file under
   `packages/db/migrations/` to verify the SQL matches the schema-change
   intent. Drizzle generates from the schema diff, so a mismatch
   usually means the schema in `packages/db/src/schema.ts` (or its
   re-exports from `@felafel/contracts`) is not in the state the user
   expected. Surface any surprises to the user before they stage.

4. **Remind the user** that the orchestrator applies migrations
   automatically on startup via `createDb()` in
   `packages/db/src/client.ts` — they don't need to run
   `pnpm --filter @felafel/db db:migrate` separately for the new
   migration to take effect locally.
