import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BrandSpinner } from '@/components/brand-spinner';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

/** After this, a spinner stops being reassuring and starts looking like a freeze. */
const SLOW_AFTER_MS = 6_000;

/**
 * What the app shows between "signed in" and "profile loaded". It exists
 * because the alternative — rendering nothing until the profile arrives — is
 * indistinguishable from a crash: a slow or dropped request left the screen
 * blank and unresponsive with no way out, which is how this state reached
 * App Review. A stalled read now offers a retry and a way back to sign-in.
 */
export function SessionLoadingScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { profileStalled, refreshProfile, signOut } = useAuth();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  const stuck = slow || profileStalled;

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {!profileStalled && <BrandSpinner color={theme.accentText} />}
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        {stuck ? t.loadingSession.slow : t.loadingSession.message}
      </ThemedText>

      {stuck && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => { void refreshProfile(); }}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
            ]}>
            <ThemedText style={{ color: theme.buttonText }}>{t.loadingSession.retry}</ThemedText>
          </Pressable>

          {/* The way out when retrying does not help: signing out always lands
              on a screen that works, which is what an unresponsive app lacks. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => { void signOut(); }}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">{t.common.signOut}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  text: {
    textAlign: 'center',
  },
  actions: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  button: {
    borderRadius: Spacing.three + Spacing.one,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  pressed: {
    opacity: 0.6,
  },
});
