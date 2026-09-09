import { Link } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { PasswordInput } from '@/components/password-input';
import { RuleChecklist } from '@/components/rule-checklist';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

const USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;

const inputStyle = (theme: ReturnType<typeof useTheme>) => [
  styles.input,
  { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
];

/**
 * First step of employee self-serve signup, split in two so a mistyped code
 * is caught before any account exists: enter the join code and confirm the
 * company it resolves to, only then does the signup form appear. The bare
 * account created here (mirrors sign-up.tsx's chef flow — just a login, no
 * profile yet) carries the validated code forward in user_metadata; the rest
 * (name, phone) is collected on the onboarding screen this navigates to,
 * since redeem_employee_join_code() needs a real auth.uid() to attach a
 * profile to.
 */
export default function JoinScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { checkJoinCode, signUpAsEmployee } = useAuth();

  const [joinCode, setJoinCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signupError, setSignupError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedUsername = username.trim().toLowerCase();
  const canSubmitCode = joinCode.trim().length >= 4 && !checking;
  const canSubmitSignup = !!trimmedUsername && !!password;

  async function handleCheckCode() {
    setCodeError(null);
    setChecking(true);
    const { companyName, error } = await checkJoinCode(joinCode.trim());
    setChecking(false);
    if (error) {
      setCodeError(error);
      return;
    }
    if (!companyName) {
      setCodeError(t.join.codeNotFound);
      return;
    }
    setCompanyName(companyName);
  }

  function handleChangeCode() {
    setCompanyName(null);
    setCodeError(null);
    setSignupError(null);
  }

  async function handleSubmitSignup() {
    setSignupError(null);

    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setSignupError(t.join.usernamePatternError);
      return;
    }

    if (password.length < 6) {
      setSignupError(t.join.passwordTooShort);
      return;
    }

    setSubmitting(true);
    const { error } = await signUpAsEmployee(trimmedUsername, password, joinCode.trim());
    setSubmitting(false);
    if (error) setSignupError(error);
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          {t.join.title}
        </ThemedText>

        {!companyName ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              {t.join.codeSubtitle}
            </ThemedText>

            <ThemedView style={styles.form}>
              <TextInput
                style={inputStyle(theme)}
                placeholder={t.join.codePlaceholder}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={joinCode}
                onChangeText={setJoinCode}
              />

              {codeError && (
                <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                  {codeError}
                </ThemedText>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.accent, opacity: pressed || !canSubmitCode ? 0.7 : 1 },
                ]}
                disabled={!canSubmitCode}
                onPress={handleCheckCode}>
                <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                  {checking ? t.join.checking : t.join.continue}
                </ThemedText>
              </Pressable>

              <Link href="/sign-in" style={styles.link}>
                <ThemedText type="linkPrimary">{t.join.signInLink}</ThemedText>
              </Link>
            </ThemedView>
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              {t.join.joiningPrefix} <ThemedText type="smallBold">{companyName}</ThemedText>
              {t.join.joiningSuffix}
            </ThemedText>

            <ThemedView style={styles.form}>
              <TextInput
                style={inputStyle(theme)}
                placeholder={t.join.usernamePlaceholder}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                value={username}
                onChangeText={setUsername}
              />

              <RuleChecklist rules={[
                { label: t.join.ruleLength, met: trimmedUsername.length >= 3 && trimmedUsername.length <= 20 },
                { label: t.join.ruleNoAccent, met: trimmedUsername.length > 0 && !/[\s-]|[^\x00-\x7F]/.test(trimmedUsername) },
              ]} />

              <PasswordInput
                style={inputStyle(theme)}
                placeholder={t.join.passwordPlaceholder}
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={password}
                onChangeText={setPassword}
              />

              <RuleChecklist rules={[
                { label: t.join.rulePassword, met: password.length >= 6 },
              ]} />

              {signupError && (
                <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                  {signupError}
                </ThemedText>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: theme.accent,
                    opacity: pressed || submitting || !canSubmitSignup ? 0.7 : 1,
                  },
                ]}
                disabled={submitting || !canSubmitSignup}
                onPress={handleSubmitSignup}>
                <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                  {submitting ? t.join.creatingAccount : t.join.createAccount}
                </ThemedText>
              </Pressable>

              <Pressable onPress={handleChangeCode} disabled={submitting}>
                <ThemedText type="linkPrimary" style={styles.link}>
                  {t.join.changeCode}
                </ThemedText>
              </Pressable>
            </ThemedView>
          </>
        )}
      </SafeAreaView>
    </DismissKeyboardView>
  );
}

const styles = StyleSheet.create({
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
  link: {
    alignSelf: 'center',
  },
  error: {
    
  },
});
