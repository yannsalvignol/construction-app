import { createClient } from '@supabase/supabase-js'
import './sqlite-local-storage'
// Before the client is created: auth-js decides at call time whether it can
// hash the PKCE verifier, and this is what lets it answer yes.
import './web-crypto-polyfill'
import 'react-native-url-polyfill/auto'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const webSafeStorage = {
  getItem: (key: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  setItem: (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  },
  removeItem: (key: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
  },
}

/**
 * No request may hang for ever. React Native's fetch has no default timeout,
 * so on a network that accepts a connection and then stalls — a VPN or a
 * corporate proxy, which is what App Review runs behind — a call simply never
 * settles and the screen waiting on it looks frozen. That is how a sign-in
 * attempt left the button reading "Connexion…" indefinitely.
 *
 * Uploads get a far longer budget: a devis photographed on site is megabytes
 * over a poor connection, and cutting that off at thirty seconds would break a
 * transfer that was working.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

// Built from AbortController and setTimeout rather than AbortSignal.timeout()
// and AbortSignal.any(): those are recent additions, and every request in the
// app goes through here, so a missing global would break the whole client.
async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Request timed out')),
    url.includes('/storage/v1/') ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  );
  // An abort the caller asked for still wins; this only adds a ceiling.
  const forward = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener('abort', forward);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', forward);
  }
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    global: { fetch: fetchWithTimeout },
    auth: {
      storage: webSafeStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // OAuth (Google) returns a one-time code to the app's deep link instead
      // of tokens in the URL fragment; exchangeCodeForSession() then finishes
      // the sign-in. The verifier lives in the storage configured above.
      flowType: 'pkce',
    },
  }
)