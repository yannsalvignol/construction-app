import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

      <Pressable
        style={({ pressed }) => [
          styles.button,
          { borderColor: theme.backgroundSelected, opacity: pressed || busy ? 0.7 : 1 },
        ]}
        disabled={!!busy}
        onPress={() => handle('google')}>
        <Ionicons name="logo-google" size={20} color={theme.text} />
        <ThemedText type="smallBold">{busy === 'google' ? t.social.googleBusy : t.social.google}</ThemedText>
      </Pressable>

      {appleAvailable && (
        <Pressable
          style={({ pressed }) => [
            styles.button,
            { borderColor: theme.backgroundSelected, opacity: pressed || busy ? 0.7 : 1 },
          ]}
          disabled={!!busy}
          onPress={() => handle('apple')}>
          <Ionicons name="logo-apple" size={20} color={theme.text} />
          <ThemedText type="smallBold">{busy === 'apple' ? t.social.appleBusy : t.social.apple}</ThemedText>
        </Pressable>
      )}

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
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingVertical: Spacing.three,
  },
});
