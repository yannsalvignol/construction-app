import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandSpinner } from '@/components/brand-spinner';
import { AnimatedInput } from '@/components/animated-input';
import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { OtpInput } from '@/components/otp-input';
import { RuleChecklist } from '@/components/rule-checklist';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

/** Long enough that a slow inbox is not mistaken for a lost email. */
const RESEND_COOLDOWN_S = 45;

/**
 * Recovery by code rather than by link: the whole reset happens on the phone
 * in hand, instead of depending on the mail being opened on the right device.
 *
 * Only for accounts that have a real address — an employee signs in with a
 * username mapped to a synthetic one nobody can read, and their chef resets
 * their password from the employee's page. Saying so here is cheaper than
 * letting them wait for a mail that will never arrive.
 */
export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const palette = useAuthPalette();
  const { t } = useI18n();
  const { startPasswordReset, verifyPasswordResetCode, completePasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Three screens in one route: the address, then the code, then the password.
  // The code is checked before the password is asked for, so a wrong one is
  // caught while it is still the only thing on screen.
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleSend() {
    Keyboard.dismiss();
    const address = email.trim();
    if (sending || !address) return;
    if (!address.includes('@')) {
      setError(t.forgotPassword.employeeError);
      return;
    }
    setError(null);
    setSending(true);
    const { error } = await startPasswordReset(address);
    setSending(false);
    if (error) {
      setError(error);
      return;
    }
    setStep('code');
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function handleCode(value: string) {
    if (checking) return;
    setChecking(true);
    setError(null);
    const { error } = await verifyPasswordResetCode(email.trim(), value);
    setChecking(false);
    if (error) {
      setError(error);
      setCode('');
      return;
    }
    setStep('password');
  }

  const longEnough = password.length >= 6;
  const matching = password.length > 0 && password === confirm;
  const canSubmit = code.length === 6 && longEnough && matching && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    const { error } = await completePasswordReset(email.trim(), code, password);
    setSaving(false);
    if (error) {
      setError(error);
      return;
    }
    // Nothing to navigate to: completePasswordReset signs in with the new
    // password, and the root navigator swaps the signed-out stack — this
    // screen included — for the signed-in one.
  }

  return (
    <DismissKeyboardView style={[styles.container, { backgroundColor: palette.page }]}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>
          {t.forgotPassword.title}
          <ThemedText type="subtitle" style={{ color: theme.accent }}>.</ThemedText>
        </ThemedText>

        <ThemedView style={[styles.form, { backgroundColor: palette.page }]}>
          {step === 'email' ? (
            <>
              <AnimatedInput
                surface={palette.field}
                labelColor={palette.fieldText}
                label={t.forgotPassword.emailPlaceholder}
                height={64}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                returnKeyType="send"
                onSubmitEditing={handleSend}
                value={email}
                onChangeText={(value) => { setEmail(value); setError(null); }}
              />

              {error && <ErrorLine message={error} />}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.accent, opacity: pressed || sending ? 0.7 : 1 },
                ]}
                disabled={sending || !email.trim()}
                onPress={handleSend}>
                <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
                  {sending ? t.forgotPassword.submitting : t.forgotPassword.submit}
                </ThemedText>
              </Pressable>
            </>
          ) : step === 'code' ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t.forgotPassword.codeSentTo(email.trim())}
              </ThemedText>

              <OtpInput
                surface={palette.field}
                value={code}
                onChange={(next) => { setCode(next); setError(null); }}
                onComplete={handleCode}
                disabled={checking}
              />

              {checking && (
                <View style={styles.status}>
                  <BrandSpinner color={theme.accentText} />
                  <ThemedText type="small" themeColor="textSecondary">{t.verifyEmail.checking}</ThemedText>
                </View>
              )}

              {error && !checking && <ErrorLine message={error} />}

              <View style={styles.resendRow}>
                {sending ? (
                  <View style={styles.status}>
                    <BrandSpinner color={theme.accentText} />
                    <ThemedText type="small" themeColor="textSecondary">
                      {t.account.security.sending}
                    </ThemedText>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={cooldown > 0 || saving}
                    onPress={() => { setCode(''); void handleSend(); }}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedText type="linkPrimary" style={{ opacity: cooldown > 0 ? 0.5 : 1 }}>
                      {cooldown > 0 ? t.verifyEmail.resendIn(cooldown) : t.verifyEmail.resend}
                    </ThemedText>
                  </Pressable>
                )}
              </View>

              <Pressable onPress={() => { setStep('email'); setCode(''); setError(null); }}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
                  {t.forgotPassword.changeEmail}
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t.forgotPassword.chooseNew}
              </ThemedText>

              <AnimatedInput
                surface={palette.field}
                labelColor={palette.fieldText}
                label={t.account.security.newPasswordPlaceholder}
                password
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                returnKeyType="next"
                value={password}
                onChangeText={(value) => { setPassword(value); setError(null); }}
              />
              <AnimatedInput
                surface={palette.field}
                labelColor={palette.fieldText}
                label={t.account.security.confirmPasswordPlaceholder}
                password
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                value={confirm}
                onChangeText={(value) => { setConfirm(value); setError(null); }}
              />

              {/* Only once there is something to judge: an empty form has no
                  rules to have broken yet. */}
              {password.length > 0 && (
                <RuleChecklist
                  rules={[
                    { label: t.account.security.passwordTooShort, met: longEnough },
                    { label: t.account.security.passwordsMatch, met: matching },
                  ]}
                />
              )}

              {error && <ErrorLine message={error} />}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.accent, opacity: pressed || !canSubmit ? 0.7 : 1 },
                ]}
                disabled={!canSubmit}
                onPress={handleSubmit}>
                <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
                  {saving ? t.account.security.updating : t.account.security.update}
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

function ErrorLine({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(160)} style={styles.status}>
      <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
      <ThemedText type="small" style={{ color: theme.danger }}>{message}</ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', flexDirection: 'row' },
  safeArea: {
    flex: 1,
    // Centred, then lifted, as on the sign-in and sign-up screens. The lift is
    // what keeps the fields clear of the keyboard on every step, since the
    // code and the two password fields all sit below the fold otherwise.
    justifyContent: 'center',
    paddingBottom: Spacing.six * 4,
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  title: { textAlign: 'left' },
  form: { gap: Spacing.three },
  resendRow: { alignItems: 'center', paddingVertical: Spacing.one },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  button: {
    borderRadius: Spacing.three + Spacing.one,
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
  buttonLabel: { fontSize: 17, fontWeight: '400' },
  link: { textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
