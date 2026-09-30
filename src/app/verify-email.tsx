import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandSpinner } from '@/components/brand-spinner';
import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { OtpInput } from '@/components/otp-input';
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
 * Confirms a new chef's email address with a 6-digit code. The account does not
 * exist yet: the code is what creates it, and the sign-in that follows gives
 * the session the root navigator routes on, so nothing here navigates.
 */
export default function VerifyEmailScreen() {
  const theme = useTheme();
  const palette = useAuthPalette();
  const { t } = useI18n();
  const { pendingSignUp, completeSignUp, resendSignUpCode, cancelSignUp } = useAuth();
  const email = pendingSignUp?.email ?? '';

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const requested = useRef(false);

  const send = useCallback(async () => {
    setError(null);
    setCooldown(RESEND_COOLDOWN_S);
    const { error } = await resendSignUpCode();
    if (error) setError(error);
  }, [resendSignUpCode]);

  // start-signup already sent the first code; this screen only resends. The
  // countdown therefore starts on arrival, not on a send of its own.
  useEffect(() => {
    requested.current = true;
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleComplete(value: string) {
    if (checking) return;
    setChecking(true);
    setError(null);
    const { error } = await completeSignUp(value);
    setChecking(false);
    if (error) {
      setError(error);
      setCode('');
    }
  }

  return (
    <DismissKeyboardView style={[styles.container, { backgroundColor: palette.page }]}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>
          {t.verifyEmail.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t.verifyEmail.subtitle(email)}
        </ThemedText>

        <ThemedView style={[styles.form, { backgroundColor: palette.page }]}>
          <OtpInput
            surface={palette.field}
            value={code}
            onChange={(next) => { setCode(next); setError(null); }}
            onComplete={handleComplete}
            disabled={checking}
          />

          {checking && (
            <Animated.View entering={FadeInDown.duration(160)} style={styles.status}>
              <BrandSpinner color={theme.accentText} />
              <ThemedText type="small" themeColor="textSecondary">{t.verifyEmail.checking}</ThemedText>
            </Animated.View>
          )}

          {error && !checking && (
            <Animated.View entering={FadeInDown.duration(160)} style={styles.status}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
              <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>
            </Animated.View>
          )}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={cooldown > 0 || checking}
              onPress={() => { setCode(''); void send(); }}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary" style={{ opacity: cooldown > 0 ? 0.5 : 1 }}>
                {cooldown > 0 ? t.verifyEmail.resendIn(cooldown) : t.verifyEmail.resend}
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={cancelSignUp}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="small" themeColor="textSecondary">{t.verifyEmail.wrongEmail}</ThemedText>
            </Pressable>
          </View>
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
    justifyContent: 'center',
    paddingBottom: Spacing.six * 3,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    textAlign: 'left',
  },
  form: {
    gap: Spacing.four,
    paddingTop: Spacing.two,
    backgroundColor: 'transparent',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  actions: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
