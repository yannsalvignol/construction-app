import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { IntendedRole, useAuth, usernameFromAuthEmail } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

const inputStyle = (theme: ReturnType<typeof useTheme>) => [
  styles.input,
  { color: theme.text, backgroundColor: theme.backgroundInput },
];

function ChefOnboarding() {
  const theme = useTheme();
  const { t } = useI18n();
  const { completeChefOnboarding, signOut } = useAuth();

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
      <ThemedText type="title" style={styles.title}>
        {t.onboarding.chef.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
        {t.onboarding.chef.subtitle}
      </ThemedText>

      <ThemedView style={styles.form}>
        <TextInput
          style={inputStyle(theme)}
          placeholder={t.onboarding.chef.companyNamePlaceholder}
          placeholderTextColor={theme.textPlaceholder}
          returnKeyType="next"
          value={companyName}
          onChangeText={setCompanyName}
        />
        <TextInput
          style={inputStyle(theme)}
          placeholder={t.onboarding.chef.firstNamePlaceholder}
          placeholderTextColor={theme.textPlaceholder}
          returnKeyType="next"
          value={firstName}
          onChangeText={setFirstName}
        />
        <TextInput
          style={inputStyle(theme)}
          placeholder={t.onboarding.chef.lastNamePlaceholder}
          placeholderTextColor={theme.textPlaceholder}
          returnKeyType="next"
          value={lastName}
          onChangeText={setLastName}
        />
        <TextInput
          style={inputStyle(theme)}
          placeholder={t.onboarding.chef.phonePlaceholder}
          placeholderTextColor={theme.textPlaceholder}
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
            {submitting ? t.onboarding.chef.submitting : t.onboarding.chef.submit}
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

function EmployeeOnboarding({
  username,
  joinCode,
}: {
  username: string | null;
  joinCode: string | null;
}) {
  const theme = useTheme();
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

      <ThemedView style={styles.form}>
        {!joinCode && (
          <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
            {t.onboarding.employee.missingCodeError}
          </ThemedText>
        )}
        <TextInput
          style={inputStyle(theme)}
          placeholder={t.onboarding.employee.firstNamePlaceholder}
          placeholderTextColor={theme.textPlaceholder}
          returnKeyType="next"
          value={firstName}
          onChangeText={setFirstName}
        />
        <TextInput
          style={inputStyle(theme)}
          placeholder={t.onboarding.employee.lastNamePlaceholder}
          placeholderTextColor={theme.textPlaceholder}
          returnKeyType="next"
          value={lastName}
          onChangeText={setLastName}
        />
        <TextInput
          style={inputStyle(theme)}
          placeholder={t.onboarding.employee.phonePlaceholder}
          placeholderTextColor={theme.textPlaceholder}
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
  const intendedRole = (session?.user.user_metadata?.intended_role as IntendedRole) ?? 'chef';
  const joinCode = (session?.user.user_metadata?.join_code as string | undefined) ?? null;

  return (
    <DismissKeyboardView style={styles.container}>
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
      <Pressable onPress={() => setConfirming(true)}>
        <ThemedText type="small" style={[styles.link, { color: theme.textSecondary }]}>
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
      <Pressable disabled={busy} onPress={handleDelete}>
        <ThemedText type="smallBold" style={[styles.link, { color: theme.danger }]}>
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
  subtitle: {
    textAlign: 'center',
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
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  link: {
    alignSelf: 'center',
  },
  error: {
    
  },
});
