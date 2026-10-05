import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandSpinner } from '@/components/brand-spinner';
import { AnimatedInput } from '@/components/animated-input';
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
 * Changing a password in two steps: a code sent to the address on the account,
 * then the new password. An unlocked phone alone cannot change it, because
 * that is the one change capable of locking the real owner out.
 */
export default function ChangePasswordScreen() {
  const theme = useTheme();
  const palette = useAuthPalette();
  const router = useRouter();
  const { t } = useI18n();
  const { session, startPasswordChange, verifyPasswordChangeCode, completePasswordChange } = useAuth();
  const accountEmail = session?.user.email ?? '';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Three screens in one route, as on the forgotten-password flow: the address
  // is confirmed, then the code is checked, and only then is the new password
  // asked for, so a wrong one is caught while it is still the only thing on
  // screen.
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [done, setDone] = useState(false);
  // Cleared on unmount: a navigation fired after the screen has gone would
  // pop whatever replaced it.
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (leaving.current) clearTimeout(leaving.current); }, []);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const send = useCallback(async () => {
    setError(null);
    setSending(true);
    const { error } = await startPasswordChange();
    setSending(false);
    setCooldown(RESEND_COOLDOWN_S);
    if (error) {
      setError(error);
      return false;
    }
    return true;
  }, [startPasswordChange]);

  async function handleEmail() {
    Keyboard.dismiss();
    if (sending) return;
    // The code goes to the address on the account whatever is typed here, so a
    // mismatch is refused rather than silently ignored.
    if (email.trim().toLowerCase() !== accountEmail.toLowerCase()) {
      setError(t.account.security.emailMismatch);
      return;
    }
    if (await send()) setStep('code');
  }

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleCode(value: string) {
    if (checking) return;
    setChecking(true);
    setError(null);
    const { error } = await verifyPasswordChangeCode(value);
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
  const canSubmit = step === 'password' && longEnough && matching && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    const { error } = await completePasswordChange(code, password);
    setSaving(false);
    if (error) {
      setError(error);
      return;
    }
    setDone(true);
    setCode('');
    setPassword('');
    setConfirm('');
    // Long enough to read the tick, short enough not to be a wait.
    leaving.current = setTimeout(
      () => (router.canGoBack() ? router.back() : router.replace('/settings')),
      1200
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.page }]}>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
          <ThemedText type="subtitle" style={styles.title}>
            {t.account.security.changePassword}
            <ThemedText type="subtitle" style={{ color: theme.accent }}>.</ThemedText>
          </ThemedText>

          {done ? (
            // The confirmation stays long enough to be seen and then leaves on
            // its own. A link to press here asked the person to acknowledge
            // something they had just caused, which is a step that carries no
            // decision.
            <Animated.View entering={FadeInDown.duration(200)} style={styles.doneBlock}>
              <Ionicons name="checkmark-circle-outline" size={44} color={theme.success} />
              <ThemedText type="smallBold" style={{ color: theme.success }}>
                {t.account.security.updated}
              </ThemedText>
            </Animated.View>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {step === 'email'
                  ? t.account.security.confirmEmail
                  : step === 'code'
                    ? t.account.security.codeSentTo(accountEmail)
                    : t.forgotPassword.chooseNew}
              </ThemedText>

              {step === 'email' && (
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
                    onSubmitEditing={handleEmail}
                    value={email}
                    onChangeText={(value) => { setEmail(value); setError(null); }}
                  />

                  <Pressable
                    style={({ pressed }) => [
                      styles.button,
                      { backgroundColor: theme.accent, opacity: pressed || sending || !email.trim() ? 0.7 : 1 },
                    ]}
                    disabled={sending || !email.trim()}
                    onPress={handleEmail}>
                    <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
                      {sending ? t.forgotPassword.submitting : t.forgotPassword.submit}
                    </ThemedText>
                  </Pressable>
                </>
              )}

              {step === 'code' && (
                <>
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
                </>
              )}

              {error && !checking && (
                <Animated.View entering={FadeInDown.duration(160)} style={styles.status}>
                  <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
                  <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>
                </Animated.View>
              )}

              {step === 'code' && <View style={styles.resendRow}>
                {sending ? (
                  <View style={styles.status}>
                    <BrandSpinner color={theme.accentText} />
                    <ThemedText type="small" themeColor="textSecondary">{t.account.security.sending}</ThemedText>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={cooldown > 0 || saving}
                    onPress={() => { setCode(''); void send(); }}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedText type="linkPrimary" style={{ opacity: cooldown > 0 ? 0.5 : 1 }}>
                      {cooldown > 0 ? t.verifyEmail.resendIn(cooldown) : t.verifyEmail.resend}
                    </ThemedText>
                  </Pressable>
                )}
              </View>}

              {step === 'password' && <>
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

              {password.length > 0 && (
                <RuleChecklist
                  rules={[
                    { label: t.account.security.passwordTooShort, met: longEnough },
                    { label: t.account.security.passwordsMatch, met: matching },
                  ]}
                />
              )}

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
              </>}
            </>
          )}
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary" style={styles.centerText}>{t.common.back}</ThemedText>
          </Pressable>
        </ScrollView>
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
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  title: {
    textAlign: 'left',
    paddingBottom: Spacing.one,
  },
  centerText: {
    textAlign: 'center',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six * 3,
    gap: Spacing.three,
  },
  resendRow: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  doneBlock: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.six,
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
  pressed: {
    opacity: 0.6,
  },
});
