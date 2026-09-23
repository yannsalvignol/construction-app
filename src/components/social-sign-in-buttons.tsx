import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

// Web only: closes the OAuth popup once it lands back on the app's origin.
WebBrowser.maybeCompleteAuthSession();

type Provider = 'google' | 'apple';

/** "or" divider followed by Google and (on iOS) Apple buttons. */
export function SocialSignInButtons() {
  const theme = useTheme();
  const { t } = useI18n();
  const { signInWithGoogle, signInWithApple } = useAuth();

  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Native Sign in with Apple only exists on iOS; Android and web get Google alone.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);

  async function handle(provider: Provider) {
    if (busy) return;
    setError(null);
    setBusy(provider);
    const { error } = await (provider === 'google' ? signInWithGoogle() : signInWithApple());
    setBusy(null);
    if (error) setError(error);
  }

  return (
    <>
      <View style={styles.divider}>
        <View style={[styles.dividerLine, { backgroundColor: theme.backgroundSelected }]} />
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {t.social.or}
        </ThemedText>
        <View style={[styles.dividerLine, { backgroundColor: theme.backgroundSelected }]} />
      </View>

      {/* Icon only: the two marks are recognised without a label, and the row
          stays readable at any width. The label survives as the accessibility
          name, which is what a screen reader announces. */}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.social.google}
          accessibilityState={{ busy: busy === 'google' }}
          style={({ pressed }) => [
            styles.iconButton,
            { borderColor: theme.backgroundSelected, opacity: pressed || busy ? 0.7 : 1 },
          ]}
          disabled={!!busy}
          onPress={() => handle('google')}>
          {busy === 'google'
            ? <ActivityIndicator color={theme.text} />
            : <Ionicons name="logo-google" size={24} color={theme.text} />}
        </Pressable>

        {appleAvailable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.social.apple}
            accessibilityState={{ busy: busy === 'apple' }}
            style={({ pressed }) => [
              styles.iconButton,
              { borderColor: theme.backgroundSelected, opacity: pressed || busy ? 0.7 : 1 },
            ]}
            disabled={!!busy}
            onPress={() => handle('apple')}>
            {busy === 'apple'
              ? <ActivityIndicator color={theme.text} />
              : <Ionicons name="logo-apple" size={24} color={theme.text} />}
          </Pressable>
        )}
      </View>

      {error && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    // Sits closer to what precedes it than to the buttons it introduces.
    marginTop: -Spacing.one,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  iconButton: {
    // Each takes half the row, so the pair spans the form like the buttons
    // above it; only the label is gone, not the width.
    flex: 1,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
  },
});
