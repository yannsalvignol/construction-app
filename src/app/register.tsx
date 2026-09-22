import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

/**
 * The fork between the two ways of creating an account. Each card carries only
 * what tells the two apart — the role — since anything else is read on the
 * screen it leads to.
 */
export default function RegisterScreen() {
  const theme = useTheme();
  const { t } = useI18n();

  const options = [
    { key: 'chef', href: '/sign-up' as const, icon: 'business-outline' as const, title: t.register.chef },
    { key: 'employee', href: '/join' as const, icon: 'key-outline' as const, title: t.register.employee },
  ];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.center}>{t.register.title}</ThemedText>

        <View style={styles.cards}>
          {options.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              onPress={() => router.push(option.href)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: theme.backgroundElement, borderColor: pressed ? theme.accent : theme.backgroundSelected, opacity: pressed ? 0.9 : 1 },
              ]}>
              <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name={option.icon} size={24} color={theme.accentText} />
              </View>
              <ThemedText type="subtitle" style={styles.cardTitle}>{option.title}</ThemedText>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>
          ))}
        </View>

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
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.five,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  center: { textAlign: 'center' },
  cards: { gap: Spacing.three },
  card: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    padding: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { flex: 1 },
  link: { textAlign: 'center' },
});
