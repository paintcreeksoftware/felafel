// Electron main process entry point. The actual application lifecycle and
// state owner is `FelafelApp`, which lives in
// `apps/desktop/src/main/felafel.ts` (module-private there, exposed only
// through `startFelafelApp`). This file is a thin bootstrap.
import { startFelafelApp } from "@felafel/desktop/main/felafel";

startFelafelApp();
