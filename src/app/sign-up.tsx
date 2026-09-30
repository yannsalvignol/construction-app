import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedInput } from '@/components/animated-input';
import { BrandName } from '@/components/brand-name';
import { RuleChecklist } from '@/components/rule-checklist';
import { SocialSignInButtons } from '@/components/social-sign-in-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const palette = useAuthPalette();
  // Same as the sign-in screen: the lift is dropped on a short viewport, where
  // it would push the heading and the first field off the top.
  const { height } = useWindowDimensions();
  const lift = height > 760 ? Spacing.six * 3 : Spacing.four;
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
    <ThemedView style={[styles.container, { backgroundColor: palette.page }]}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: lift }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
        <ThemedText type="subtitle" style={styles.title}>
          {t.signUp.titleBefore}
          <BrandName />
          {t.signUp.titleAfter}
        </ThemedText>

        <ThemedView style={[styles.form, { backgroundColor: palette.page }]}>
          <AnimatedInput
            surface={palette.field}
            labelColor={palette.fieldText}
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
            surface={palette.field}
            labelColor={palette.fieldText}
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

          {/* Only once there is something to judge: an empty field has no rule
              to have broken yet. */}
          {password.length > 0 && (
            <RuleChecklist rules={[{ label: t.signUp.rulePassword, met: password.length >= 6 }]} />
          )}

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

          <SocialSignInButtons surface={palette.social} />

          <Link href="/sign-in" style={styles.link}>
            <ThemedText type="small">
              {t.signUp.signInPrompt}
              <ThemedText type="linkPrimary">{t.signUp.signInLink}</ThemedText>
            </ThemedText>
          </Link>
        </ThemedView>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
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
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  fill: {
    flex: 1,
  },
  content: {
    // Same as the sign-in screen: centred, then lifted, so the heading sits in
    // the upper third rather than level with the fields. flexGrow rather than
    // flex, so content taller than the screen scrolls instead of clipping.
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.four,
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
