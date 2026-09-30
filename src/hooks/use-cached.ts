import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

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
 * `prefetch` fills the same map ahead of time, which is what lets the home
 * screen warm the other tabs while the chef is reading it.
 */

const cache = new Map<string, unknown>();
/** In-flight loads, so a prefetch and a focus never run the same query twice. */
const pending = new Map<string, Promise<unknown>>();

async function load<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = pending.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = loader()
    .then((value) => {
      cache.set(key, value);
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

/** Warms a key without rendering anything. Failures are the caller's business
 *  to surface later; a warm-up that could not run is simply a cold tab. */
export function prefetch<T>(key: string, loader: () => Promise<T>) {
  if (cache.has(key) || pending.has(key)) return;
  void load(key, loader).catch(() => {});
}

/** Drops a key so the next read goes to the network — after a write that makes
 *  the cached value wrong. */
export function invalidate(key: string) {
  cache.delete(key);
}

export function useCached<T>(key: string, loader: () => Promise<T>) {
  // Reads the cache during the initial state, so the very first render of a
  // revisited tab already has its content.
  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined);
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
