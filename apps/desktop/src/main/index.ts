// Electron main process entry point. The actual application lifecycle and
// state owner is `DesktopApp`, which lives in
// `apps/desktop/src/main/desktop.ts` (module-private there, exposed only
// through `startDesktopApp`). This file is a thin bootstrap.
import { startDesktopApp } from "@felafel/desktop/main/desktop";

startDesktopApp();
