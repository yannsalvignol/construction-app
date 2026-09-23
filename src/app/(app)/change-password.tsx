import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedInput } from '@/components/animated-input';
import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { OtpInput } from '@/components/otp-input';
import { RuleChecklist } from '@/components/rule-checklist';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
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
  const router = useRouter();
  const { t } = useI18n();
  const { session, startPasswordChange, completePasswordChange } = useAuth();
  const email = session?.user.email ?? '';

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sending, setSending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const requested = useRef(false);

  const send = useCallback(async () => {
    setError(null);
    setSending(true);
    const { error } = await startPasswordChange();
    setSending(false);
    setCooldown(RESEND_COOLDOWN_S);
    if (error) setError(error);
  }, [startPasswordChange]);

  // One code on arrival. The ref survives the double mount React does in dev.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void send();
  }, [send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const longEnough = password.length >= 6;
  const matching = password.length > 0 && password === confirm;
  const canSubmit = code.length === 6 && longEnough && matching && !saving;

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
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityLabel={t.common.back}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <ThemedText type="subtitle" style={styles.topTitle} numberOfLines={1}>
            {t.account.security.changePassword}
          </ThemedText>
          <View style={styles.iconButton} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {done ? (
            <Animated.View entering={FadeInDown.duration(200)} style={styles.doneBlock}>
              <Ionicons name="checkmark-circle-outline" size={44} color={theme.success} />
              <ThemedText type="smallBold" style={{ color: theme.success }}>
                {t.account.security.updated}
              </ThemedText>
              <Pressable onPress={() => router.back()} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="linkPrimary">{t.common.done}</ThemedText>
              </Pressable>
            </Animated.View>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t.account.security.codeSentTo(email)}
              </ThemedText>

              <OtpInput value={code} onChange={(next) => { setCode(next); setError(null); }} disabled={saving} />

              <View style={styles.resendRow}>
                {sending ? (
                  <View style={styles.status}>
                    <ActivityIndicator color={theme.accentText} />
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
              </View>

              <AnimatedInput
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

              <RuleChecklist
                rules={[
                  { label: t.account.security.passwordTooShort, met: longEnough },
                  { label: t.account.security.passwordsMatch, met: matching },
                ]}
              />

              {error && (
                <Animated.View entering={FadeInDown.duration(160)} style={styles.status}>
                  <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
                  <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>
                </Animated.View>
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
            </>
          )}
        </ScrollView>
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
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
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
