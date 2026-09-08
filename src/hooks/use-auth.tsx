import { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/hooks/use-i18n';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';
import { unregisterPresenceNotifications } from '@/lib/presence-notifications';

const EMPLOYEE_EMAIL_DOMAIN = 'employee.local';

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
  /** Looks up a join code without needing to be signed in — used to validate
   * it on the join screen before any signup fields are even shown. */
  checkJoinCode: (joinCode: string) => Promise<{ companyName: string | null; error: string | null }>;
  signUpAsEmployee: (
    username: string,
    password: string,
    joinCode: string
  ) => Promise<{ error: string | null }>;
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
