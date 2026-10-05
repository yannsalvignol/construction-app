import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppModal, ModalButton } from '@/components/app-modal';
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

/** Seconds a tap on « Supprimer définitivement » can still be taken back. */
const DELETE_COUNTDOWN = 5;

const THEME_CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];
const LOCALES: Locale[] = ['fr', 'en'];

/** A titled card: the title sits outside it, the rows inside, as iOS does. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" style={{ color: theme.accentText }}>{title}</ThemedText>
      <ThemedView style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        {children}
      </ThemedView>
    </View>
  );
}

/**
 * One line of a card. `value` prints on the right (a version number),
 * `selected` marks a choice, `chevron` says the row leads somewhere, and
 * `tint` colours a row that acts rather than navigates.
 */
function Row({
  label,
  note,
  value,
  icon,
  tint,
  selected,
  chevron = false,
  dimmed = false,
  last = false,
  onPress,
}: {
  label: string;
  note?: string | null;
  value?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tint?: string;
  selected?: boolean;
  chevron?: boolean;
  /** Reads as unavailable, but still answers a tap. */
  dimmed?: boolean;
  last?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.backgroundSelected,
        },
        pressed && styles.pressed,
      ]}>
      <View style={styles.rowLine}>
        <ThemedText
          style={[
            styles.rowLabel,
            tint ? { color: tint } : null,
            dimmed && { color: theme.textPlaceholder },
          ]}>
          {label}
        </ThemedText>
        {value && <ThemedText type="small" themeColor="textSecondary">{value}</ThemedText>}
        {selected && <Ionicons name="checkmark" size={20} color={theme.accentText} />}
        {icon && <Ionicons name={icon} size={22} color={tint ?? theme.textSecondary} />}
        {chevron && <Ionicons name="chevron-forward" size={20} color={theme.textPlaceholder} />}
      </View>
      {note && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowNote}>
          {note}
        </ThemedText>
      )}
    </Pressable>
  );
}

/** Réglages: account, appearance, language, legal and account deletion.
 * Reached from the gear on the Compte screen; pushed over the tabs. */
export function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const { session, profile, signOut } = useAuth();
  // A Google/Apple-only account has no password to change. An "email"
  // identity means one exists (also true for a social login Supabase linked
  // onto an existing email account), so the row stays available then.
  const identities = session?.user.identities ?? [];
  const socialOnlyProvider = identities.some((i) => i.provider === 'email')
    ? null
    : identities.find((i) => i.provider === 'google' || i.provider === 'apple')?.provider ?? null;

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readStoredThemeChoice);
  const [openLegalNote, setOpenLegalNote] = useState<'privacy' | 'terms' | null>(null);
  const [socialNoticeOpen, setSocialNoticeOpen] = useState(false);
  const provider = socialOnlyProvider === 'apple' ? 'Apple' : 'Google';
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  // Seconds left before the account goes. Null when no deletion is pending.
  const [countdown, setCountdown] = useState<number | null>(null);

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeletionError(null);
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      const message = await resolveFunctionError('delete-account', error);
      setDeletionError(message ? translateServerError(message, locale) : t.account.deletion.failed);
      setDeleting(false);
      setCountdown(null);
      return;
    }
    // The auth user no longer exists, so the server-side sign-out is expected to
    // fail; the local session still has to go.
    await signOut().catch(() => supabase.auth.signOut({ scope: 'local' }));
  }

  // Five seconds between the last tap and a deletion that cannot be undone.
  // The one thing in this app that destroys a company's record is also the one
  // thing a thumb can reach by accident on a scrolling page, and "are you
  // sure?" is a question people answer yes to without reading.
  useEffect(() => {
    if (countdown === null || deleting) return;
    // The last tick is the one that deletes, so the sheet shows five whole
    // seconds rather than four and a flash of zero.
    const timer = setTimeout(() => {
      if (countdown > 1) { setCountdown(countdown - 1); return; }
      setCountdown(0);
      void handleDeleteAccount();
    }, 1000);
    return () => clearTimeout(timer);
    // handleDeleteAccount is redeclared each render but never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, deleting]);

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

  return (
    <ThemedView style={styles.container}>
      {/* No bottom edge: the list scrolls under the home indicator instead of
          stopping short of it, as on the other screens. */}
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel={t.common.back}
          style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={30} color={theme.text} />
          <ThemedText type="subtitle" style={styles.headerTitle}>{t.settings.title}</ThemedText>
        </Pressable>

        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.six + insets.bottom }]}>
          <Section title={t.settings.accountSection}>
            {profile.role === 'chef' && (
              <Row
                label={t.account.security.changePassword}
                // Still pressable when there is no password to change: saying
                // why is more use than a row that ignores the tap.
                dimmed={!!socialOnlyProvider}
                chevron={!socialOnlyProvider}
                onPress={() =>
                  socialOnlyProvider ? setSocialNoticeOpen(true) : router.push('/change-password')
                }
              />
            )}
            {/* What he agreed to, and how to take it back. A page of its own,
                reached from here, because it used to be a button at the foot
                of the day screen that opened its text at the top — so pressing
                it looked like nothing had happened. */}
            {profile.role === 'employee' && (
              <Row
                label={t.settings.consent}
                chevron
                onPress={() => router.push('/consent')}
              />
            )}
            <Row
              label={t.common.signOut}
              icon="log-out-outline"
              tint={theme.accentText}
              onPress={signOut}
            />
            <Row
              label={t.account.deletion.action}
              tint={theme.danger}
              last
              onPress={() => setConfirmingDeletion((open) => !open)}
            />
          </Section>

          {confirmingDeletion && (
            <ThemedView style={[styles.card, styles.confirm, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                {profile.role === 'chef'
                  ? t.account.deletion.chefWarning
                  : t.account.deletion.employeeWarning}
              </ThemedText>
              {deletionError && (
                <ThemedText type="small" style={{ color: theme.danger }}>{deletionError}</ThemedText>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.danger, opacity: pressed || deleting ? 0.7 : 1 },
                ]}
                disabled={deleting}
                onPress={() => setCountdown(DELETE_COUNTDOWN)}>
                <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                  {deleting ? t.account.deletion.deleting : t.account.deletion.confirm}
                </ThemedText>
              </Pressable>
              <Pressable disabled={deleting} onPress={() => setConfirmingDeletion(false)}>
                <ThemedText type="linkPrimary" style={styles.centerText}>{t.common.cancel}</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          <Section title={t.settings.appearance.title}>
            {THEME_CHOICES.map((choice, index) => (
              <Row
                key={choice}
                label={t.settings.appearance[choice]}
                selected={themeChoice === choice}
                last={index === THEME_CHOICES.length - 1}
                onPress={() => changeTheme(choice)}
              />
            ))}
          </Section>

          <Section title={t.account.language.title}>
            {LOCALES.map((key, index) => (
              <Row
                key={key}
                label={key === 'fr' ? t.account.language.french : t.account.language.english}
                selected={locale === key}
                last={index === LOCALES.length - 1}
                onPress={() => setLocale(key)}
              />
            ))}
          </Section>

          <Section title={t.account.about.title}>
            <Row label={t.account.about.version} value={APP_VERSION} />
            <Row
              label={t.account.about.privacyPolicy}
              note={openLegalNote === 'privacy' ? [workCopy(locale).noticePrivacy, workCopy(locale).noticeAccess, workCopy(locale).noticeRights].join('\n\n') : null}
              chevron
              onPress={() => openLegal('privacy')}
            />
            <Row
              label={t.account.about.termsOfService}
              note={openLegalNote === 'terms' ? t.account.about.notAvailableYet : null}
              chevron
              last
              onPress={() => openLegal('terms')}
            />
          </Section>
        </ScrollView>

        {/* The last chance: a running number, and one button to stop it. The
            sheet cannot be dismissed once the request has left. */}
        <AppModal
          visible={countdown !== null}
          onClose={() => { if (!deleting) setCountdown(null); }}
          title={t.account.deletion.countdownTitle}
          icon="alert-circle-outline"
          iconColor={theme.danger}
          actions={
            deleting ? null : (
              <ModalButton label={t.account.deletion.keep} onPress={() => setCountdown(null)} />
            )
          }>
          <ThemedText style={[styles.countdown, { color: theme.danger }]}>
            {deleting ? t.account.deletion.deleting : countdown}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {t.account.deletion.countdownBody}
          </ThemedText>
        </AppModal>

        <AppModal
          visible={socialNoticeOpen}
          onClose={() => setSocialNoticeOpen(false)}
          title={t.account.security.noPasswordTitle}
          icon={socialOnlyProvider === 'apple' ? 'logo-apple' : 'logo-google'}
          actions={
            <>
              {/* The password does exist — at the provider — so the sheet
                  offers the place it can actually be changed. */}
              <ModalButton
                label={t.account.security.manageAt(provider)}
                icon="open-outline"
                onPress={() => {
                  setSocialNoticeOpen(false);
                  WebBrowser.openBrowserAsync(
                    socialOnlyProvider === 'apple'
                      ? 'https://appleid.apple.com'
                      : 'https://myaccount.google.com/security'
                  ).catch(() => {});
                }}
              />
              <ModalButton secondary label={t.common.done} onPress={() => setSocialNoticeOpen(false)} />
            </>
          }>
          <ThemedText type="small" themeColor="textSecondary">
            {t.account.security.socialOnly(provider)}
          </ThemedText>
        </AppModal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  countdown: {
    fontSize: 56,
    lineHeight: 64,
    fontWeight: '700',
    textAlign: 'center',
  },
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 32,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  row: {
    paddingVertical: Spacing.three + Spacing.half,
  },
  rowLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
  },
  rowNote: {
    paddingTop: Spacing.one,
  },
  confirm: {
    gap: Spacing.three,
    paddingVertical: Spacing.four,
    marginTop: -Spacing.three,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
