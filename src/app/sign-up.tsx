import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { signUp } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    const { error } = await signUp(email.trim(), password);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          {t.signUp.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          {t.signUp.subtitle}
        </ThemedText>

        <ThemedView style={styles.form}>
          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
            placeholder={t.signUp.emailPlaceholder}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
            placeholder={t.signUp.passwordPlaceholder}
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.text, opacity: pressed || submitting ? 0.7 : 1 },
            ]}
            disabled={submitting || !email || !password}
            onPress={handleSubmit}>
            <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
              {submitting ? t.signUp.submitting : t.signUp.submit}
            </ThemedText>
          </Pressable>

          <Link href="/sign-in" style={styles.link}>
            <ThemedText type="linkPrimary">{t.signUp.signInLink}</ThemedText>
          </Link>
        </ThemedView>
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
    color: '#e5484d',
  },
});
