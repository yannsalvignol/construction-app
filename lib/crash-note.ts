import './sqlite-local-storage';

/**
 * Writes down the error that would otherwise have killed the app.
 *
 * A fatal JavaScript error in a release build reaches React Native's global
 * handler, which hands it to expo-updates; expo-updates looks for a newer
 * bundle to rescue the app and, finding none, aborts the process on purpose.
 * The crash report that comes back names that abort and nothing else — the
 * message, the file and the line are all in a log nobody can reach from a
 * phone in somebody else's pocket.
 *
 * So the handler records it first, in storage that survives, and then keeps
 * quiet instead of letting the process die. The next render shows what it
 * caught, selectable, so a tester can read it out.
 *
 * This is a diagnostic, not a safety net. After a fatal error the state of
 * the app is not to be trusted; swallowing one buys a message and nothing
 * more. It comes out again once the bug it found is fixed.
 */
const KEY = 'casprod:last-fatal';
const MAX = 4000;

type Handler = (error: unknown, isFatal?: boolean) => void;

function describe(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n\n${error.stack ?? '(no stack)'}`;
  }
  try { return String(error); } catch { return '(unprintable error)'; }
}

export function readFatal(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(KEY);
  } catch { return null; }
}

export function clearFatal() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch { /* nothing to clear */ }
}

/** Exported so the error boundary can record a render-phase throw too. */
export function recordFatal(error: unknown) {
  const text = `${new Date().toISOString()}\n${describe(error)}`.slice(0, MAX);
  // Console first: if storage is the thing that is broken, the log still has it.
  console.error('[fatal]', text);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, text);
  } catch { /* the console copy is all there is */ }
}

export function installFatalRecorder() {
  const utils = (globalThis as { ErrorUtils?: {
    setGlobalHandler?: (handler: Handler) => void;
    getGlobalHandler?: () => Handler | undefined;
  } }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, isFatal) => {
    recordFatal(error);
    // A non-fatal error keeps its ordinary path — a red box in development,
    // a warning in release. Only the fatal one is held back, because letting
    // it through is what ends the process before anybody can read it.
    if (!isFatal) previous?.(error, isFatal);
  });
}
