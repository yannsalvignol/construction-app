import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Link, router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

const ENTER_STAGGER_MS = 110;

/**
 * The fork between the two ways of creating an account: two panels filling the
 * screen, each carrying only the role. Everything else is read on the screen
 * it leads to. They spring in one after the other so the choice reads as two
 * options rather than one block of interface.
 */
export default function RegisterScreen() {
  const theme = useTheme();
  const { t } = useI18n();

  // One tap per panel, timed with its spring, so the arrival is felt as well
  // as seen. Haptics have no web implementation, hence the platform check.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const timers = [0, ENTER_STAGGER_MS].map((delay, index) =>
      setTimeout(
        () => Haptics.impactAsync(index === 0 ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
        delay + 60
      )
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const options = [
    { key: 'chef', href: '/sign-up' as const, icon: 'person-outline' as const, title: t.register.chef },
    { key: 'employee', href: '/join' as const, icon: 'qr-code-outline' as const, title: t.register.employee },
  ];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {options.map((option, index) => (
          <Animated.View
            key={option.key}
            style={styles.cardWrapper}
            entering={FadeInDown.springify().damping(16).mass(0.6).delay(index * ENTER_STAGGER_MS)}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(option.href)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: pressed ? theme.accentSoft : theme.backgroundElement,
                  borderColor: pressed ? theme.accent : theme.backgroundSelected,
                },
              ]}>
              <ThemedView style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name={option.icon} size={38} color={theme.accentText} />
              </ThemedView>
              <ThemedText type="title" style={styles.cardTitle}>{option.title}</ThemedText>
            </Pressable>
          </Animated.View>
        ))}

        <Link href="/sign-in" style={styles.link}>
          <ThemedText type="linkPrimary">{t.register.signInLink}</ThemedText>
        </Link>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', flexDirection: 'row' },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  cardWrapper: { flex: 1 },
  card: {
    flex: 1,
    borderRadius: Spacing.four,
    borderWidth: 1,
    padding: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { textAlign: 'center' },
  link: { textAlign: 'center', paddingBottom: Spacing.two },
});
