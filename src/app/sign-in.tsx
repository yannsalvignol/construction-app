import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedInput } from '@/components/animated-input';
import { BrandName } from '@/components/brand-name';
import { SocialSignInButtons } from '@/components/social-sign-in-buttons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { clearLockout, readLockout } from '@/lib/lockout';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

export default function SignInScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // Set once, by the sign-out that ended the last session, so the screen can
  // say why he is back here instead of looking like a bug.
  const [lockedOut, setLockedOut] = useState(readLockout);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordInput = useRef<TextInput>(null);
  // The greeting sits in the upper third on a phone. On a short viewport —
  // an iPad running this iPhone-only build, or an SE — that lift pushes the
  // top of the form off screen, so it is dropped rather than scrolled past.
  const { height } = useWindowDimensions();
  const lift = height > 760 ? Spacing.six * 3 : Spacing.four;
  const palette = useAuthPalette();

  async function handleSubmit() {
    Keyboard.dismiss();
    passwordInput.current?.blur();
    if (submitting || !identifier.trim() || !password) return;
    setError(null);
    // A new attempt is a new answer: if the company is still shut the gate
    // puts the notice straight back, and if it has been paid it must go.
    clearLockout();
    setLockedOut(false);
    setSubmitting(true);
    const { error } = await signIn(identifier.trim(), password);
    setSubmitting(false);
    if (error) setError(error);
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.page }]}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Scrollable so nothing is ever unreachable: with the keyboard up on
              a short screen the submit button would otherwise sit under it,
              with no way to bring it back. */}
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: lift }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
        {lockedOut && (
          <ThemedView style={[styles.notice, { backgroundColor: theme.warningSoft }]}>
            <ThemedText type="small" themeColor="warning">{t.signIn.companyLocked}</ThemedText>
          </ThemedView>
        )}
        <ThemedText type="subtitle" style={styles.title}>
          {t.signIn.titleBefore}
          <BrandName />
          {t.signIn.titleAfter}
        </ThemedText>

        <ThemedView style={[styles.form, { backgroundColor: palette.page }]}>
          <AnimatedInput
            label={t.signIn.identifierPlaceholder}
            surface={palette.field}
            labelColor={palette.fieldText}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordInput.current?.focus()}
            // No autofill hints: they are what makes the system draw its own
            // envelope and key glyphs inside the fields.
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            value={identifier}
            onChangeText={setIdentifier}
          />

          <AnimatedInput
            ref={passwordInput}
            label={t.signIn.passwordPlaceholder}
            surface={palette.field}
            labelColor={palette.fieldText}
            password
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={handleSubmit}
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
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
            <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
              {submitting ? t.signIn.submitting : t.signIn.submit}
            </ThemedText>
          </Pressable>

          <SocialSignInButtons surface={palette.social} />

          {/* The question stays in body colour so only the action reads as tappable. */}
          <Link href="/register" style={styles.link}>
            <ThemedText type="link">{t.signIn.registerPrompt} </ThemedText>
            <ThemedText type="linkPrimary">{t.signIn.registerAction}</ThemedText>
          </Link>
        </ThemedView>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderRadius: 14,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
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
    // Centred, then lifted: the welcome sits in the upper third rather than
    // level with the fields, which reads as a greeting instead of a label.
    // flexGrow rather than flex so the content can outgrow the screen and
    // scroll instead of being clipped.
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
  buttonLabel: {
    fontSize: 17,
    fontWeight: '400',
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
