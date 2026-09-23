import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { InfoRow, LinkRow, PillChoice } from '@/components/settings-rows';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { resolveFunctionError } from '@/lib/edge-function-error';
import type { Locale } from '@/lib/i18n/locale';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';
import { readStoredThemeChoice, saveThemeChoice, type ThemeChoice } from '@/lib/theme-choice';
import { workCopy } from '@/lib/work-copy';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
// Hosted legal pages. App Store Connect needs a public privacy-policy URL and
// the app has to link to it; until one is configured the in-app notice shows.
const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL;

const THEME_CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];
const LOCALES: Locale[] = ['fr', 'en'];

/** Réglages: appearance, language, legal, account deletion and sign-out.
 * Reached from the gear on the Compte screen; pushed over the tabs. */
export function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const { session, profile, signOut } = useAuth();
  // A Google/Apple-only account has no password to change. An "email"
  // identity means one exists (also true for a social login Supabase linked
  // onto an existing email account), so the form stays available then.
  const identities = session?.user.identities ?? [];
  const socialOnlyProvider = identities.some((i) => i.provider === 'email')
    ? null
    : identities.find((i) => i.provider === 'google' || i.provider === 'apple')?.provider ?? null;

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readStoredThemeChoice);
  const [openLegalNote, setOpenLegalNote] = useState<'privacy' | 'terms' | null>(null);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  if (!profile) return null;

  function changeTheme(choice: ThemeChoice) {
    setThemeChoice(choice);
    saveThemeChoice(choice);
  }

  function openLegal(kind: 'privacy' | 'terms') {
    const url = kind === 'privacy' ? PRIVACY_POLICY_URL : TERMS_URL;
    if (url) {
      WebBrowser.openBrowserAsync(url).catch(() => setOpenLegalNote(kind));
      return;
    }
    setOpenLegalNote((current) => (current === kind ? null : kind));
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeletionError(null);
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      const message = await resolveFunctionError('delete-account', error);
      setDeletionError(message ? translateServerError(message, locale) : t.account.deletion.failed);
      setDeleting(false);
      return;
    }
    // The auth user no longer exists, so the server-side sign-out is expected to
    // fail; the local session still has to go.
    await signOut().catch(() => supabase.auth.signOut({ scope: 'local' }));
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel={t.common.back}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="subtitle" style={styles.topTitle} numberOfLines={1}>
            {t.settings.title}
          </ThemedText>
          <View style={styles.iconButton} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.settings.appearance.title}</ThemedText>
            <PillChoice
              options={THEME_CHOICES.map((key) => ({ key, label: t.settings.appearance[key] }))}
              value={themeChoice}
              onChange={changeTheme}
            />
          </ThemedView>

          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.account.language.title}</ThemedText>
            <PillChoice
              options={LOCALES.map((key) => ({
                key,
                label: key === 'fr' ? t.account.language.french : t.account.language.english,
              }))}
              value={locale}
              onChange={setLocale}
            />
          </ThemedView>

          {profile.role === 'chef' && (
            <ThemedView style={[styles.section, styles.transparent]}>
              <ThemedText type="smallBold">{t.account.security.title}</ThemedText>

              {/* The change itself is confirmed by a code emailed to the
                  account, so it lives on its own screen rather than inline. */}
              <LinkRow
                label={t.account.security.changePassword}
                note={
                  socialOnlyProvider
                    ? t.account.security.socialOnly(socialOnlyProvider === 'apple' ? 'Apple' : 'Google')
                    : null
                }
                onPress={() => {
                  if (!socialOnlyProvider) router.push('/change-password');
                }}
              />
            </ThemedView>
          )}

          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.account.about.title}</ThemedText>
            <InfoRow label={t.account.about.version} value={APP_VERSION} />
            <LinkRow
              label={t.account.about.privacyPolicy}
              note={openLegalNote === 'privacy' ? [workCopy(locale).noticePrivacy, workCopy(locale).noticeAccess, workCopy(locale).noticeRights].join('\n\n') : null}
              onPress={() => openLegal('privacy')}
            />
            <LinkRow
              label={t.account.about.termsOfService}
              note={openLegalNote === 'terms' ? t.account.about.notAvailableYet : null}
              onPress={() => openLegal('terms')}
            />
          </ThemedView>

          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.account.deletion.title}</ThemedText>
            {confirmingDeletion ? (
              <ThemedView style={[styles.expandedForm, styles.transparent]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {profile.role === 'chef'
                    ? t.account.deletion.chefWarning
                    : t.account.deletion.employeeWarning}
                </ThemedText>
                {deletionError && (
                  <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                    {deletionError}
                  </ThemedText>
                )}
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    { backgroundColor: theme.danger, opacity: pressed || deleting ? 0.7 : 1 },
                  ]}
                  disabled={deleting}
                  onPress={handleDeleteAccount}>
                  <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                    {deleting ? t.account.deletion.deleting : t.account.deletion.confirm}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => setConfirmingDeletion(false)} disabled={deleting}>
                  <ThemedText type="linkPrimary" style={styles.centerText}>
                    {t.common.cancel}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            ) : (
              <Pressable onPress={() => setConfirmingDeletion(true)}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {t.account.deletion.action}
                </ThemedText>
              </Pressable>
            )}
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {t.account.signedInAs(t.account.role[profile.role])}
          </ThemedText>

          <Pressable onPress={signOut}>
            <ThemedText type="linkPrimary" style={styles.centerText}>
              {t.common.signOut}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </DismissKeyboardView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
  centerText: {
    textAlign: 'center',
  },
  section: {
    gap: Spacing.three,
  },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  error: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  expandedForm: {
    gap: Spacing.three,
    paddingTop: Spacing.one,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
