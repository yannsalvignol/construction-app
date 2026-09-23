import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { PasswordInput } from '@/components/password-input';
import { SocialSignInButtons } from '@/components/social-sign-in-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

export default function SignInScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordInput = useRef<TextInput>(null);

  async function handleSubmit() {
    Keyboard.dismiss();
    passwordInput.current?.blur();
    if (submitting || !identifier.trim() || !password) return;
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(identifier.trim(), password);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>
          {t.signIn.title}
          {/* The dot is the brand's, hence the accent colour. */}
          <ThemedText type="subtitle" style={{ color: theme.accent }}>.</ThemedText>
          <ThemedText type="subtitle"> !</ThemedText>
        </ThemedText>

        <ThemedView style={styles.form}>
          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundInput }]}
            placeholder={t.signIn.identifierPlaceholder}
            placeholderTextColor={theme.textPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordInput.current?.focus()}
            autoComplete="username"
            textContentType="username"
            value={identifier}
            onChangeText={setIdentifier}
          />

          <PasswordInput
            ref={passwordInput}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundInput }]}
            placeholder={t.signIn.passwordPlaceholder}
            placeholderTextColor={theme.textPlaceholder}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={handleSubmit}
            autoComplete="current-password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
          />

          {/* Next to the field it is about, aligned right so it reads as a way
              out of the form rather than another action to take. */}
          <Link href="/forgot-password" style={styles.forgotLink}>
            <ThemedText type="linkPrimary">{t.signIn.forgotLink}</ThemedText>
          </Link>

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
            disabled={submitting || !identifier || !password}
            onPress={handleSubmit}>
            <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
              {submitting ? t.signIn.submitting : t.signIn.submit}
            </ThemedText>
          </Pressable>

          <SocialSignInButtons />

          {/* The question stays in body colour so only the action reads as tappable. */}
          <Link href="/register" style={styles.link}>
            <ThemedText type="link">{t.signIn.registerPrompt} </ThemedText>
            <ThemedText type="linkPrimary">{t.signIn.registerAction}</ThemedText>
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
    // Centred, then lifted: the welcome sits in the upper third rather than
    // level with the fields, which reads as a greeting instead of a label.
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
  forgotLink: {
    textAlign: 'right',
    // The form's gap would leave it floating between the button and the social
    // buttons; pulled up so it reads as belonging to the button above it.
    marginTop: -14,
  },
  link: {
    alignSelf: 'center',
  },
  error: {
    
  },
});
