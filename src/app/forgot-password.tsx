import { Link } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

/**
 * Recovery by email, so only for accounts that have one: an employee signs in
 * with a username mapped to a synthetic address nobody can read, and their
 * chef resets their password from the employee's page. Saying so here is
 * cheaper than letting them wait for a mail that will never arrive.
 */
export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { sendPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    Keyboard.dismiss();
    const address = email.trim();
    if (submitting || !address) return;
    if (!address.includes('@')) {
      setError(t.forgotPassword.employeeError);
      return;
    }
    setError(null);
    setSubmitting(true);
    const { error } = await sendPasswordReset(address);
    setSubmitting(false);
    if (error) setError(error);
    else setSent(true);
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          {t.forgotPassword.title}
        </ThemedText>

        <ThemedView style={styles.form}>
          {sent ? (
            <ThemedText themeColor="textSecondary">{t.forgotPassword.sent(email.trim())}</ThemedText>
          ) : (
            <>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
                placeholder={t.forgotPassword.emailPlaceholder}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType="send"
                onSubmitEditing={handleSubmit}
                value={email}
                onChangeText={setEmail}
              />

              {error && (
                <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                  {error}
                </ThemedText>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.accent, opacity: pressed || submitting ? 0.7 : 1 },
                ]}
                disabled={submitting || !email.trim()}
                onPress={handleSubmit}>
                <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                  {submitting ? t.forgotPassword.submitting : t.forgotPassword.submit}
                </ThemedText>
              </Pressable>
            </>
          )}

          <Link href="/sign-in" style={styles.link}>
            <ThemedText type="linkPrimary">{t.forgotPassword.backLink}</ThemedText>
          </Link>
        </ThemedView>
      </SafeAreaView>
    </DismissKeyboardView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', flexDirection: 'row' },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  title: { textAlign: 'center' },
  form: { gap: Spacing.three },
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
  error: { textAlign: 'center' },
  link: { textAlign: 'center' },
});
