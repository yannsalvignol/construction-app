import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Link, router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useTheme } from '@/hooks/use-theme';

const ENTER_STAGGER_MS = 110;

/**
 * The fork between the two ways of creating an account: two panels filling the
 * screen, each carrying only the role. Everything else is read on the screen
 * it leads to. They spring in one after the other so the choice reads as two
 * options rather than one block of interface.
 */
export default function RegisterScreen() {
  const { t } = useI18n();
  const palette = useAuthPalette();

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
    <ThemedView style={[styles.container, { backgroundColor: palette.page }]}>
      <SafeAreaView style={styles.safeArea}>
        {options.map((option, index) => (
          <Animated.View
            key={option.key}
            style={styles.cardWrapper}
            entering={FadeInDown.springify().damping(16).mass(0.6).delay(index * ENTER_STAGGER_MS)}>
            <RoleCard icon={option.icon} title={option.title} onPress={() => router.push(option.href)} />
          </Animated.View>
        ))}

        <Link href="/sign-in" style={styles.link}>
          <ThemedText type="small">
            {t.register.signInPrompt}
            <ThemedText type="linkPrimary">{t.register.signInLink}</ThemedText>
          </ThemedText>
        </Link>
      </SafeAreaView>
    </ThemedView>
  );
}

/**
 * One of the two panels. Pressing it sinks the card slightly and lifts its
 * shadow away, the way a physical key gives under a thumb — read at a glance
 * on a screen whose only content is this choice.
 */
function RoleCard({
  icon,
  title,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const pressed = useSharedValue(0);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }],
    shadowOpacity: (theme.isDark ? 0.45 : 0.12) * (1 - pressed.value * 0.7),
    shadowRadius: 22 - pressed.value * 12,
    elevation: 6 - pressed.value * 4,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => { pressed.value = withTiming(1, { duration: 90 }); }}
      onPressOut={() => { pressed.value = withSpring(0, { damping: 14, stiffness: 240 }); }}
      style={styles.cardWrapper}>
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
          cardStyle,
        ]}>
        <Ionicons name={icon} size={44} color={theme.text} />
        <ThemedText type="title" style={styles.cardTitle}>
          {title}
          {/* The dot is the brand's, as on the sign-in heading. */}
          <ThemedText type="title" style={{ color: theme.accent }}>.</ThemedText>
        </ThemedText>
      </Animated.View>
    </Pressable>
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
    // Raised off the background, so the two panels read as objects to press.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
  },
  cardTitle: { textAlign: 'center' },
  link: { textAlign: 'center', paddingBottom: Spacing.two },
});
