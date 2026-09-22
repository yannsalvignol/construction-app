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
 * The fork between the two ways of creating an account. The sign-in screen
 * used to offer both paths at once, which asked people to read two sentences
 * before they could tell which one was theirs; here each path is a card with
 * its own heading and the one line that distinguishes it.
 */
export default function RegisterScreen() {
  const theme = useTheme();
  const { t } = useI18n();

  const options = [
    { key: 'chef', href: '/sign-up' as const, icon: 'business-outline' as const, ...t.register.chef },
    { key: 'employee', href: '/join' as const, icon: 'key-outline' as const, ...t.register.employee },
  ];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.center}>{t.register.title}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>{t.register.subtitle}</ThemedText>
        </View>

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
                <Ionicons name={option.icon} size={26} color={theme.accentText} />
              </View>
              <ThemedText type="subtitle">{option.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{option.body}</ThemedText>
              <View style={styles.cardFoot}>
                <ThemedText type="smallBold" themeColor="accentText">{option.action}</ThemedText>
                <Ionicons name="arrow-forward" size={16} color={theme.accentText} />
              </View>
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
  header: { gap: Spacing.two },
  center: { textAlign: 'center' },
  cards: { gap: Spacing.three },
  card: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one },
  link: { textAlign: 'center' },
});
