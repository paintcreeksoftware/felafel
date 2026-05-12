// Scaffold barrel for @felafel/tailscale. Real exports (TailscaleManager,
// parseStatusJson, classifyServeError, isServeFailureError, the worker IP
// helper, etc.) land per PAI-139 when the manager + worker helper + pill
// move into this package. Sub-path exports for the React pill and the
// worker IP helper are declared once those files arrive.

/**
 * Marker type so this scaffold barrel has a real export and lint passes.
 * Replaced by the real surface (TailscaleManager, parsers, classifiers,
 * etc.) when PAI-139 implementation lands.
 */
export type PackageScaffoldMarker = never;
