import { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/hooks/use-i18n';
import { resolveFunctionError } from '@/lib/edge-function-error';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';
import { unregisterPresenceNotifications } from '@/lib/presence-notifications';

const EMPLOYEE_EMAIL_DOMAIN = 'employee.local';

/** Deep-link path Supabase sends the OAuth code back to. Rewritten to "/" by
 * src/app/+native-intent.tsx so the router never tries to render it. */
export const OAUTH_CALLBACK_PATH = 'auth/callback';

/** Reads the PKCE code out of an OAuth callback URL, or null if it isn't one. */
export function oauthCodeFromUrl(url: string | null | undefined) {
  if (!url?.includes(OAUTH_CALLBACK_PATH)) return null;
  const code = Linking.parse(url).queryParams?.code;
  return typeof code === 'string' ? code : null;
}

// The callback can reach us twice — from openAuthSessionAsync() and as a
// plain deep link (Android always; Expo Go on iOS, where the exp:// link
// re-opens the project and drops the awaiting promise). A code is single-use,
// so only the first arrival exchanges it.
const exchangedCodes = new Set<string>();
async function exchangeOAuthCode(code: string) {
  if (exchangedCodes.has(code)) return { error: null };
  exchangedCodes.add(code);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) console.error('[auth] OAuth code exchange failed', error);
  return { error };
}

function toAuthEmail(identifier: string) {
  const trimmed = identifier.trim();
  return trimmed.includes('@') ? trimmed : `${trimmed.toLowerCase()}@${EMPLOYEE_EMAIL_DOMAIN}`;
}

/** Inverse of toAuthEmail() for a synthetic employee address, e.g. to show a
 * signed-in-but-not-onboarded employee the username they just chose. */
export function usernameFromAuthEmail(email: string | undefined | null) {
  if (!email?.endsWith(`@${EMPLOYEE_EMAIL_DOMAIN}`)) return null;
  return email.slice(0, -`@${EMPLOYEE_EMAIL_DOMAIN}`.length);
}

export type Profile = {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  role: 'employee' | 'chef';
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
};

/**
 * Which onboarding form a profile-less signed-in user should see. Stored in
 * Supabase Auth's user_metadata (not our own schema) at signUp() time, so it
 * survives an app restart mid-onboarding — the alternative of inferring it
 * from which screen the user came from wouldn't, since a reload always lands
 * back on the same "session but no profile" route with no navigation state.
 */
export type IntendedRole = 'chef' | 'employee';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Emails a recovery link. Only chefs have a real address — an employee's
   * username maps to a synthetic @employee.local one that receives nothing,
   * so the caller refuses those before asking. */
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  /** Google OAuth through the system browser. Works in Expo Go (no native
   * module). A new Google user lands in chef onboarding since intended_role
   * can't travel through OAuth and onboarding.tsx defaults to chef. Returns a
   * null error when the user simply closed the browser. */
  signInWithGoogle: () => Promise<{ error: string | null }>;
  /** Native Sign in with Apple (iOS only — the caller hides the button where
   * AppleAuthentication.isAvailableAsync() is false). Same role handling as
   * Google. Returns a null error when the user cancels the sheet. */
  signInWithApple: () => Promise<{ error: string | null }>;
  /** Looks up a join code without needing to be signed in — used to validate
   * it on the join screen before any signup fields are even shown. */
  checkJoinCode: (joinCode: string) => Promise<{ companyName: string | null; error: string | null }>;
  signUpAsEmployee: (
    username: string,
    password: string,
    joinCode: string
  ) => Promise<{ error: string | null }>;
  /** Deletes the signed-in account (the delete-account Edge Function does the
   * work), then clears the local session. Available before onboarding too,
   * where there is no profile yet — just the sign-in. */
  deleteAccount: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  completeChefOnboarding: (params: {
    companyName: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) => Promise<{ error: string | null }>;
  joinCompanyAsEmployee: (params: {
    joinCode: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { locale, t } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const profileRequest = useRef(0);
  const currentUser = useRef<string | null>(null);
  const fetchProfile = useCallback(async (userId: string) => {
    const request = ++profileRequest.current;
    try {
      const { data, error } = await supabase.from('profiles')
        .select('id, company_id, first_name, last_name, role, phone, avatar_url, is_active')
        .eq('id', userId).maybeSingle();
      if (request !== profileRequest.current || currentUser.current !== userId) return;
      if (error) console.error('[auth] profile lookup failed', error.message);
      setProfile(data);
    } finally {
      if (request === profileRequest.current) setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let authEventSeen = false;
    function applySession(next: Session | null) {
      if (!active) return;
      const nextId = next?.user.id ?? null;
      setSession(next);
      setSessionLoading(false);
      if (nextId !== currentUser.current) {
        currentUser.current = nextId;
        profileRequest.current++;
        setProfile(null);
        setProfileLoading(!!nextId);
        if (nextId) void fetchProfile(nextId);
      }
    }
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      authEventSeen = true;
      // Avoid issuing a Supabase query while the auth callback holds its lock.
      queueMicrotask(() => applySession(next));
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!authEventSeen) applySession(data.session);
    }).catch(() => { if (active) setSessionLoading(false); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [fetchProfile]);

  // Finish an OAuth sign-in delivered as a deep link (see exchangeOAuthCode).
  useEffect(() => {
    const handle = (url: string | null) => {
      const code = oauthCodeFromUrl(url);
      if (code) void exchangeOAuthCode(code);
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  // Apply profile edits without unmounting an active form or camera flow.
  useEffect(() => {
    if (!session) return;
    const userId = session.user.id;

    const channel = supabase
      .channel(`own-profile-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => setProfile(payload.new as Profile)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading: sessionLoading || profileLoading,
      signIn: async (identifier, rawPassword) => {
        const email = toAuthEmail(identifier);
        const password = rawPassword.trim();

        if (password !== rawPassword) {
          console.warn(
            '[auth] signIn: password had leading/trailing whitespace that was trimmed before submitting — this is a common copy/paste or autocorrect slip'
          );
        }

        console.log('[auth] signIn attempt', {
          identifier,
          resolvedEmail: email,
          passwordLength: password.length,
        });

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
          console.error('[auth] signIn failed', {
            identifier,
            resolvedEmail: email,
            status: error.status,
            code: error.code,
            message: error.message,
          });
        } else {
          console.log('[auth] signIn succeeded', { userId: data.user?.id, resolvedEmail: email });
        }

        return { error: error ? translateServerError(error.message, locale) : null };
      },
      signUp: async (email, password) => {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { intended_role: 'chef' satisfies IntendedRole } },
        });
        return { error: error ? translateServerError(error.message, locale) : null };
      },
      sendPasswordReset: async (email) => {
        // The link comes back through the OAuth callback path, which exchanges
        // the code for a session; the account screen is where the new password
        // is set.
        const redirectTo = Linking.createURL(OAUTH_CALLBACK_PATH);
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) console.error('[auth] sendPasswordReset failed', { email, error });
        return { error: error ? translateServerError(error.message, locale) : null };
      },
      signInWithGoogle: async () => {
        const redirectTo = Linking.createURL(OAUTH_CALLBACK_PATH);
        // Must be allow-listed under Authentication → URL Configuration in Supabase.
        console.log('[auth] signInWithGoogle redirectTo', redirectTo);
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data.url) {
          console.error('[auth] signInWithGoogle: could not build OAuth URL', error);
          return { error: translateServerError(error?.message ?? 'OAuth URL missing', locale) };
        }

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success') return { error: null };

        const code = oauthCodeFromUrl(result.url);
        if (!code) {
          const { queryParams } = Linking.parse(result.url);
          const providerError = queryParams?.error_description ?? queryParams?.error;
          const message = typeof providerError === 'string' ? providerError : 'OAuth callback missing code';
          console.error('[auth] signInWithGoogle: bad callback', { url: result.url, message });
          return { error: translateServerError(message, locale) };
        }

        const { error: exchangeError } = await exchangeOAuthCode(code);
        return { error: exchangeError ? translateServerError(exchangeError.message, locale) : null };
      },
      signInWithApple: async () => {
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
          });
        } catch (e) {
          if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return { error: null };
          console.error('[auth] signInWithApple: sheet failed', e);
          return { error: translateServerError((e as Error).message, locale) };
        }
        if (!credential.identityToken) {
          console.error('[auth] signInWithApple: no identityToken in credential');
          return { error: translateServerError('Apple returned no identity token', locale) };
        }

        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) {
          console.error('[auth] signInWithApple failed', error);
          return { error: translateServerError(error.message, locale) };
        }

        // Apple sends the name on the very first authorisation only, and
        // never again — keep it in user_metadata so onboarding can use it.
        const { givenName, familyName } = credential.fullName ?? {};
        if (givenName || familyName) {
          await supabase.auth
            .updateUser({ data: { first_name: givenName ?? undefined, last_name: familyName ?? undefined } })
            .catch((e) => console.warn('[auth] signInWithApple: could not store name', e));
        }
        return { error: null };
      },
      // Returning a null companyName with a null error is the "not found"
      // signal (as opposed to an actual RPC failure) so the caller can show
      // its own translated copy — this hook stays translation-output-free
      // apart from genuine server error text.
      checkJoinCode: async (joinCode) => {
        const { data, error } = await supabase.rpc('find_company_by_join_code', {
          input_join_code: joinCode,
        });

        if (error) {
          console.error('[auth] checkJoinCode failed', { joinCode, error });
          return { companyName: null, error: translateServerError(error.message, locale) };
        }

        return { companyName: data?.[0]?.company_name ?? null, error: null };
      },
      // The join code is captured in user_metadata alongside intended_role
      // (see IntendedRole above) rather than asked for again on the
      // onboarding screen: it was already validated by checkJoinCode() one
      // screen ago, and metadata is what survives the signUp()-triggered
      // remount into onboarding.tsx the same way intended_role does.
      signUpAsEmployee: async (username, password, joinCode) => {
        const email = toAuthEmail(username);
        const normalizedJoinCode = joinCode.trim().toUpperCase();
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              intended_role: 'employee' satisfies IntendedRole,
              join_code: normalizedJoinCode,
            },
          },
        });

        if (error) {
          console.error('[auth] signUpAsEmployee failed', { username, resolvedEmail: email, error });
        }

        return { error: error ? translateServerError(error.message, locale) : null };
      },
      deleteAccount: async () => {
        const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
        if (error) {
          const message = await resolveFunctionError('delete-account', error);
          return { error: message ? translateServerError(message, locale) : null };
        }
        // The auth user is gone, so the server-side sign-out would fail.
        await supabase.auth.signOut({ scope: 'local' });
        return { error: null };
      },
      signOut: async () => {
        await unregisterPresenceNotifications().catch(() => {});
        await supabase.auth.signOut();
      },
      refreshProfile: async () => {
        if (!session) return;
        await fetchProfile(session.user.id);
      },
      completeChefOnboarding: async ({ companyName, firstName, lastName, phone }) => {
        if (!session) return { error: t.common.notSignedIn };

        const { error } = await supabase.rpc('create_company_and_chef_profile', {
          company_name: companyName,
          chef_first_name: firstName,
          chef_last_name: lastName,
          chef_phone: phone ?? null,
        });
        if (error) return { error: translateServerError(error.message, locale) };

        await fetchProfile(session.user.id);
        return { error: null };
      },
      joinCompanyAsEmployee: async ({ joinCode, firstName, lastName, phone }) => {
        if (!session) return { error: t.common.notSignedIn };

        const { error } = await supabase.rpc('redeem_employee_join_code', {
          input_join_code: joinCode,
          employee_first_name: firstName,
          employee_last_name: lastName,
          employee_phone: phone ?? null,
        });
        if (error) return { error: translateServerError(error.message, locale) };

        await fetchProfile(session.user.id);
        return { error: null };
      },
    }),
    [session, profile, sessionLoading, profileLoading, fetchProfile, locale, t]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
