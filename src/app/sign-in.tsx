import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { KEYBOARD_DONE_BAR_ID, KeyboardDoneBar } from '@/components/keyboard-done-bar';
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
        <ThemedText type="title" style={styles.title}>
          {t.signIn.title}
        </ThemedText>

        <ThemedView style={styles.form}>
          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
            placeholder={t.signIn.identifierPlaceholder}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordInput.current?.focus()}
            autoComplete="username"
            textContentType="username"
            value={identifier}
            onChangeText={setIdentifier}
            inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}
          />

          <TextInput
            ref={passwordInput}
            style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
            placeholder={t.signIn.passwordPlaceholder}
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={handleSubmit}
            autoComplete="current-password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}
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
            disabled={submitting || !identifier || !password}
            onPress={handleSubmit}>
            <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
              {submitting ? t.signIn.submitting : t.signIn.submit}
            </ThemedText>
          </Pressable>

          <Link href="/sign-up" style={styles.link}>
            <ThemedText type="linkPrimary">{t.signIn.ownerLink}</ThemedText>
          </Link>

          <Link href="/join" style={styles.link}>
            <ThemedText type="linkPrimary">{t.signIn.joinLink}</ThemedText>
          </Link>
        </ThemedView>
      </SafeAreaView>
      <KeyboardDoneBar />
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
