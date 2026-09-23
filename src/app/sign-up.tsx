import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedInput } from '@/components/animated-input';
import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { RuleChecklist } from '@/components/rule-checklist';
import { SocialSignInButtons } from '@/components/social-sign-in-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { startSignUp } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const { error } = await startSignUp(email.trim(), password);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    router.push('/verify-email');
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>
          {t.signUp.title}
          {/* The dot is the brand's, as on the sign-in heading. */}
          <ThemedText type="subtitle" style={{ color: theme.accent }}>.</ThemedText>
        </ThemedText>

        <ThemedView style={styles.form}>
          <AnimatedInput
            label={t.signUp.emailPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            returnKeyType="next"
            value={email}
            onChangeText={setEmail}
          />

          <AnimatedInput
            label={t.signUp.passwordPlaceholder}
            password
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            value={password}
            onChangeText={setPassword}
          />

          <RuleChecklist rules={[{ label: t.signUp.rulePassword, met: password.length >= 6 }]} />

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
            disabled={submitting || !email || !password}
            onPress={handleSubmit}>
            <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
              {submitting ? t.signUp.submitting : t.signUp.submit}
            </ThemedText>
          </Pressable>

          <SocialSignInButtons />

          <Link href="/sign-in" style={styles.link}>
            <ThemedText type="linkPrimary">{t.signUp.signInLink}</ThemedText>
          </Link>
        </ThemedView>
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
    // Same as the sign-in screen: centred, then lifted, so the heading sits in
    // the upper third rather than level with the fields.
    justifyContent: 'center',
    paddingBottom: Spacing.six * 3,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    textAlign: 'left',
  },
  form: {
    gap: Spacing.three,
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
  error: {
    
  },
});
