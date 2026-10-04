import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import '@/lib/sqlite-local-storage';

/**
 * Keeps what a tab last loaded, so returning to it shows the content at once
 * instead of an empty screen that fills in a moment later.
 *
 * The value is held in a module-level map rather than in component state,
 * because a tab's screen unmounts when you leave it. On focus the loader runs
 * again and the cached value is replaced, so what is shown is never more than
 * one visit stale — the cache removes the blank frame, it does not decide what
 * is true.
 *
 * It also survives the app being closed. A map alone meant the first launch of
 * the day showed every tab empty for as long as the network took, which is the
 * one moment the emptiness is least excusable: the chef has just opened the
 * app and has no idea whether it is working. What was on screen yesterday is a
 * better first frame than nothing, and it is replaced within the second.
 *
 * Written through `localStorage`, which expo-sqlite installs synchronously, so
 * the very first render can read it. Values must therefore be JSON — these are
 * query results, which they are.
 *
 * `prefetch` fills the same map ahead of time, which is what lets the home
 * screen warm the other tabs while the chef is reading it.
 */

/** Bumped when a cached shape changes, so yesterday's rows cannot come back
 *  into today's components with a field missing. */
const SCHEMA = 'v1';
const DISK_PREFIX = `casprod:cache:${SCHEMA}:`;

const cache = new Map<string, unknown>();

function readDisk<T>(key: string): T | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(DISK_PREFIX + key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch { return undefined; }
}

function writeDisk(key: string, value: unknown) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISK_PREFIX + key, JSON.stringify(value));
    }
  } catch { /* a full or unavailable store costs a blank frame, nothing more */ }
}

/** Reads through to disk once, then from memory. */
function peek<T>(key: string): T | undefined {
  if (cache.has(key)) return cache.get(key) as T;
  const stored = readDisk<T>(key);
  if (stored !== undefined) cache.set(key, stored);
  return stored;
}

/**
 * Forgets everything, on disk as well as in memory.
 *
 * Called when a session ends: this holds one company's employees, sites and
 * planning, and the next person to sign in on this phone must not be shown
 * them for the second before their own data arrives.
 */
export function clearCache() {
  cache.clear();
  try {
    if (typeof localStorage === 'undefined') return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('casprod:cache:')) localStorage.removeItem(key);
    }
  } catch { /* nothing to clear if the store will not open */ }
}
/** In-flight loads, so a prefetch and a focus never run the same query twice. */
const pending = new Map<string, Promise<unknown>>();

async function load<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = pending.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = loader()
    .then((value) => {
      cache.set(key, value);
      writeDisk(key, value);
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

/**
 * Warms a key without rendering anything. Failures are the caller's business
 * to surface later; a warm-up that could not run is simply a cold tab.
 *
 * Resolves with what was loaded, so a caller can warm what the rows point at
 * in turn — avatars, say — and `undefined` when the load failed, because a
 * warm-up that rejects is not an error anybody is waiting on.
 */
export function prefetch<T>(key: string, loader: () => Promise<T>): Promise<T | undefined> {
  // A value on disk is shown at once but is still yesterday's, so the warm-up
  // runs anyway; only a load already in flight is joined rather than repeated.
  const existing = pending.get(key) as Promise<T> | undefined;
  if (existing) return existing.catch(() => undefined);
  return load(key, loader).catch(() => undefined);
}

/** Drops a key so the next read goes to the network — after a write that makes
 *  the cached value wrong. */
export function invalidate(key: string) {
  cache.delete(key);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(DISK_PREFIX + key);
  } catch { /* the memory copy is gone, which is the one that is read first */ }
}

/**
 * The cache for a screen that owns its own refreshing — a realtime channel, a
 * poll — and wants only the first frame from here rather than the whole
 * lifecycle `useCached` imposes.
 */
export function readCache<T>(key: string): T | undefined {
  return peek<T>(key);
}

export function writeCache<T>(key: string, value: T) {
  cache.set(key, value);
  writeDisk(key, value);
}

export function useCached<T>(key: string, loader: () => Promise<T>) {
  // Reads the cache during the initial state, so the very first render of a
  // revisited tab already has its content.
  const [data, setData] = useState<T | undefined>(() => peek<T>(key));
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await load(key, loader));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [key, loader]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load(key, loader).then(
        (value) => { if (active) { setData(value); setError(null); } },
        (failure) => { if (active) setError(failure); }
      );
      return () => { active = false; };
    }, [key, loader])
  );

  return { data, error, refresh, loading: data === undefined && !error };
}
