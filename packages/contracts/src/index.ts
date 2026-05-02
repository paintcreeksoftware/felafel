// Barrel for @felafel/contracts. Two surfaces:
//
// - `./schema` — Drizzle table definitions. Re-exported from the package
//   subpath (`@felafel/contracts/schema`) for callers that need the table
//   objects directly (drizzle-kit's config, the @felafel/db client builder).
// - everything below — wire-shape Zod schemas + types, the surface
//   @felafel/shared re-exports for non-DB consumers.

export {
  JobAssignmentSchema,
  RunCompleteSchema,
  RunSchema,
  RunStatusSchema,
  WorkerRegistrationSchema,
  WorkerSchema,
  WorkerStatusSchema,
  type JobAssignment,
  type Run,
  type RunComplete,
  type RunStatus,
  type Worker,
  type WorkerRegistration,
  type WorkerStatus,
} from "@felafel/contracts/zod";
