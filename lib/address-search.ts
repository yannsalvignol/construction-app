import { supabase } from './supabase';

export type PlaceSuggestion = { id: string; label: string; detail: string };

/**
 * Address suggestions as the chef types, and the position of the one he picks.
 *
 * The key lives in the place-search function, not here: a Places key in the
 * binary is a key somebody else can spend.
 */
export async function suggestAddresses(input: string, options: {
  near?: { latitude: number; longitude: number } | null;
  session: string;
  locale: string;
}): Promise<PlaceSuggestion[]> {
  const { data, error } = await supabase.functions.invoke('place-search', {
    body: {
      action: 'suggest',
      input,
      session: options.session,
      locale: options.locale,
      latitude: options.near?.latitude,
      longitude: options.near?.longitude,
    },
  });
  if (error) throw error;
  return (data?.suggestions ?? []) as PlaceSuggestion[];
}

export async function resolveAddress(id: string) {
  const { data, error } = await supabase.functions.invoke('place-search', {
    body: { action: 'resolve', id },
  });
  if (error) throw error;
  return data as { latitude: number; longitude: number; address: string };
}

/** One token per run of typing, so Google bills the session rather than each keystroke. */
export function newSearchSession() {
  return globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2);
}
