import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Two kinds of update, and only one can be forced quietly.
 *
 * A change to the JavaScript travels over the air: the app fetches it and
 * reloads itself, and the person sees a blink. A change to the native code
 * cannot travel that way, and the only thing that delivers it is the person
 * going to the store — so for that one the app has to stop and say so.
 *
 * Checked on launch and whenever the app comes back to the foreground, which
 * is when a phone that has been in a pocket all morning finally has signal.
 */
export type UpdateState = 'ok' | 'checking' | 'store';

/** Compares two dotted versions. Missing parts count as zero: 1.1 < 1.1.1. */
export function isOlder(version: string, floor: string) {
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = floor.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) < (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) > (b[i] ?? 0)) return false;
  }
  return false;
}

/** What this binary calls itself; the floor is compared against it. */
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

export function useRequiredUpdate() {
  const [state, setState] = useState<UpdateState>('ok');
  const [note, setNote] = useState<string | null>(null);

  const check = useCallback(async () => {
    // The over-the-air half first, and silently: if there is a new bundle for
    // this binary, take it now rather than next launch. A failure here is a
    // phone with no signal, which is not a reason to say anything.
    if (!__DEV__) {
      try {
        const found = await Updates.checkForUpdateAsync();
        if (found.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
          return;
        }
      } catch { /* no signal, or updates disabled in this build */ }
    }

    // The store half, which cannot be done for them.
    const { data } = await supabase
      .from('app_policy')
      .select('minimum_version, note_fr, note_en')
      .maybeSingle();
    if (!data) return;
    if (isOlder(APP_VERSION, data.minimum_version)) {
      setNote(data.note_fr ?? null);
      setState('store');
    } else {
      setState('ok');
    }
  }, []);

  useEffect(() => {
    // Deferred off the effect body rather than run inside it: this is a
    // network round trip and an update fetch, and the first frame must not
    // wait on either.
    const first = setTimeout(() => { void check(); }, 0);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void check();
    });
    return () => { clearTimeout(first); subscription.remove(); };
  }, [check]);

  return { state, note, recheck: check };
}
