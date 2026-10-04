import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedInput } from '@/components/animated-input';
import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { LevelMark } from '@/components/level-mark';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { IntendedRole, useAuth, usernameFromAuthEmail } from '@/hooks/use-auth';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

const inputStyle = (theme: ReturnType<typeof useTheme>) => [
  styles.input,
  { color: theme.text, backgroundColor: theme.backgroundInput },
];

function ChefOnboarding() {
  const theme = useTheme();
  const palette = useAuthPalette();
  const { t } = useI18n();
  const { session, completeChefOnboarding, signOut } = useAuth();
  // Apple's Hide My Email hands us a relay address, which can never be matched
  // to the real one: someone who already has a CASPROD account and signs in
  // this way lands here, about to create a second company without meaning to.
  const hiddenEmail = session?.user.email?.endsWith('@privaterelay.appleid.com') ?? false;

  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = companyName.trim() && firstName.trim() && lastName.trim();

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const { error } = await completeChefOnboarding({
      companyName: companyName.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim() || undefined,
    });
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <>
      <ThemedView style={styles.mark}>
        <LevelMark />
      </ThemedView>

      {hiddenEmail && (
        <ThemedView style={[styles.notice, { borderColor: theme.warning }]}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.warning} />
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
            {t.onboarding.chef.hiddenEmail}
          </ThemedText>
        </ThemedView>
      )}

      <ThemedText type="subtitle" style={styles.chefTitle}>
        {t.onboarding.chef.title}
        {/* The dot is the brand's, as on the sign-in and sign-up headings. */}
        <ThemedText type="subtitle" style={{ color: theme.accent }}>.</ThemedText>
      </ThemedText>

      <ThemedView style={[styles.form, { backgroundColor: palette.page }]}>
        <AnimatedInput
          surface={palette.field}
          labelColor={palette.fieldText}
          label={t.onboarding.chef.companyNamePlaceholder}
          returnKeyType="next"
          value={companyName}
          onChangeText={setCompanyName}
        />
        <AnimatedInput
          surface={palette.field}
          labelColor={palette.fieldText}
          label={t.onboarding.chef.firstNamePlaceholder}
          returnKeyType="next"
          value={firstName}
          onChangeText={setFirstName}
        />
        <AnimatedInput
          surface={palette.field}
          labelColor={palette.fieldText}
          label={t.onboarding.chef.lastNamePlaceholder}
          returnKeyType="next"
          value={lastName}
          onChangeText={setLastName}
        />
        <AnimatedInput
          surface={palette.field}
          labelColor={palette.fieldText}
          label={t.onboarding.chef.phonePlaceholder}
          keyboardType="phone-pad"
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          value={phone}
          onChangeText={setPhone}
        />

        {error && (
          <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
            {error}
          </ThemedText>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.accent, opacity: pressed || submitting || !canSubmit ? 0.7 : 1 },
          ]}
          disabled={submitting || !canSubmit}
          onPress={handleSubmit}>
          <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
            {submitting ? t.onboarding.chef.submitting : t.onboarding.chef.submit}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={signOut}
          style={({ pressed }) => [
            styles.pillButton,
            { borderColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText type="smallBold">{t.common.signOut}</ThemedText>
        </Pressable>

        <DeleteAccountLink />
      </ThemedView>
    </>
  );
}

function EmployeeOnboarding({
  username,
  joinCode,
}: {
  username: string | null;
  joinCode: string | null;
}) {
  const theme = useTheme();
  const palette = useAuthPalette();
  const { t } = useI18n();
  const { joinCompanyAsEmployee, signOut } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !!joinCode && firstName.trim() && lastName.trim();

  async function handleSubmit() {
    if (!joinCode) return;

    setError(null);
    setSubmitting(true);
    const { error } = await joinCompanyAsEmployee({
      joinCode,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim() || undefined,
    });
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <>
      <ThemedText type="title" style={styles.title}>
        {t.onboarding.employee.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
        {username ? t.onboarding.employee.willSignInAs(username) : ''}
        {t.onboarding.employee.subtitle}
      </ThemedText>

      <ThemedView style={[styles.form, { backgroundColor: palette.page }]}>
        {!joinCode && (
          <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
            {t.onboarding.employee.missingCodeError}
          </ThemedText>
        )}
        <TextInput
          allowFontScaling={false}
          style={[inputStyle(theme), { backgroundColor: palette.field }]}
          placeholder={t.onboarding.employee.firstNamePlaceholder}
          placeholderTextColor={palette.fieldText}
          returnKeyType="next"
          value={firstName}
          onChangeText={setFirstName}
        />
        <TextInput
          allowFontScaling={false}
          style={[inputStyle(theme), { backgroundColor: palette.field }]}
          placeholder={t.onboarding.employee.lastNamePlaceholder}
          placeholderTextColor={palette.fieldText}
          returnKeyType="next"
          value={lastName}
          onChangeText={setLastName}
        />
        <TextInput
          allowFontScaling={false}
          style={[inputStyle(theme), { backgroundColor: palette.field }]}
          placeholder={t.onboarding.employee.phonePlaceholder}
          placeholderTextColor={palette.fieldText}
          keyboardType="phone-pad"
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          value={phone}
          onChangeText={setPhone}
        />

        {error && (
          <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
            {error}
          </ThemedText>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.accent, opacity: pressed || submitting || !canSubmit ? 0.7 : 1 },
          ]}
          disabled={submitting || !canSubmit}
          onPress={handleSubmit}>
          <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
            {submitting ? t.onboarding.employee.submitting : t.onboarding.employee.submit}
          </ThemedText>
        </Pressable>

        <Pressable onPress={signOut}>
          <ThemedText type="linkPrimary" style={styles.link}>
            {t.common.signOut}
          </ThemedText>
        </Pressable>

        <DeleteAccountLink />
      </ThemedView>
    </>
  );
}

/**
 * Reached by anyone with a session but no profiles row yet: a brand new
 * account, one step short of finishing signup. Which form to show is decided
 * by intended_role in the Supabase Auth user's metadata (set at signUp()
 * time in sign-up.tsx / join.tsx), not by which screen they came from -- that
 * survives an app restart mid-onboarding, when there is no navigation state
 * to fall back on. Missing metadata (an account from before this existed)
 * defaults to the chef flow, since that was the only path until now.
 *
 * The employee form doesn't ask for the join code again: it was already
 * validated on join.tsx (checkJoinCode()) before this account even existed,
 * and travels here the same way intended_role does.
 */
export default function OnboardingScreen() {
  const { session } = useAuth();
  const palette = useAuthPalette();
  const intendedRole = (session?.user.user_metadata?.intended_role as IntendedRole) ?? 'chef';
  const joinCode = (session?.user.user_metadata?.join_code as string | undefined) ?? null;

  return (
    <DismissKeyboardView style={[styles.container, { backgroundColor: palette.page }]}>
      <SafeAreaView style={styles.safeArea}>
        {intendedRole === 'employee' ? (
          <EmployeeOnboarding username={usernameFromAuthEmail(session?.user.email)} joinCode={joinCode} />
        ) : (
          <ChefOnboarding />
        )}
      </SafeAreaView>
    </DismissKeyboardView>
  );
}

/**
 * The account exists from signup on, before a profile does; without this the
 * only way out of a half-finished signup would be to abandon the account.
 */
function DeleteAccountLink() {
  const theme = useTheme();
  const { t } = useI18n();
  const { deleteAccount } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const { error } = await deleteAccount();
    if (error) {
      setError(error);
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Pressable
        onPress={() => setConfirming(true)}
        style={({ pressed }) => [
          styles.pillButton,
          { borderColor: theme.danger, opacity: pressed ? 0.7 : 1 },
        ]}>
        <ThemedText type="smallBold" style={{ color: theme.danger }}>
          {t.onboarding.deleteAccount}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <ThemedView style={styles.deleteBlock}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
        {t.onboarding.deleteConfirm}
      </ThemedText>
      {error && (
        <ThemedText type="small" style={[styles.link, { color: theme.danger }]}>
          {error}
        </ThemedText>
      )}
      <Pressable
        disabled={busy}
        onPress={handleDelete}
        style={({ pressed }) => [
          styles.pillButton,
          { backgroundColor: theme.danger, borderColor: theme.danger, opacity: pressed || busy ? 0.7 : 1 },
        ]}>
        <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
          {busy ? t.onboarding.deleting : t.onboarding.deleteAction}
        </ThemedText>
      </Pressable>
      <Pressable disabled={busy} onPress={() => setConfirming(false)}>
        <ThemedText type="linkPrimary" style={styles.link}>
          {t.common.cancel}
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  deleteBlock: {
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    textAlign: 'center',
  },
  chefTitle: {
    textAlign: 'left',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    backgroundColor: 'transparent',
  },
  subtitle: {
    textAlign: 'center',
  },
  mark: {
    // Air above, then the heading close underneath: the two read as one block,
    // with the space separating them from the form rather than from each other.
    paddingTop: Spacing.four,
    // Trims the layout gap without closing it: the heading stays close, but
    // not touching.
    marginBottom: Spacing.three,
    backgroundColor: 'transparent',
  },
  form: {
    gap: Spacing.three,
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: Spacing.three + Spacing.one,
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '400',
  },
  link: {
    alignSelf: 'center',
  },
  // Oval, for the two actions that leave this screen rather than finish it.
  pillButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
  },
  error: {
    
  },
});
