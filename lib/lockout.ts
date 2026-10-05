import './sqlite-local-storage';

/**
 * Why the last session ended, kept across the sign-out that ends it.
 *
 * An employee whose company has lapsed is signed out rather than parked in
 * front of a wall: there is nothing for him to do inside and nothing of his
 * employer's that should stay on his phone. But a sign-out with no reason is
 * indistinguishable from a bug, and the reason has to survive the sign-out
 * that clears everything else — so it is written here first and read by the
 * sign-in screen a moment later.
 *
 * Cleared as soon as it has been read, and by any sign-in that works: it
 * describes one moment, not a state.
 */
const KEY = 'casprod:locked-out';

export function rememberLockout() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, String(Date.now()));
  } catch { /* the screen simply says nothing */ }
}

export function readLockout(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(KEY) != null;
  } catch { return false; }
}

export function clearLockout() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch { /* nothing to clear */ }
}
