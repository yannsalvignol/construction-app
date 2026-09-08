// No-op on web: the browser's native `localStorage` is used directly.
// A separate .web.ts file (rather than a runtime Platform.OS check) keeps
// Metro from ever resolving expo-sqlite's web worker into the web bundle,
// which otherwise fails with "Worker chunk not found for ...web/worker.ts".
export {};
