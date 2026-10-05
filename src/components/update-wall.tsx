import { Linking, Platform, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Action } from '@/components/work-ui';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { APP_VERSION, useRequiredUpdate } from '@/hooks/use-required-update';

/** Straight to this app's page, not to a search for it. */
const STORE_URL = Platform.select({
  ios: 'https://apps.apple.com/app/id6806629702',
  android: 'market://details?id=com.casprod.app',
  default: 'https://casprod.app',
});

/**
 * The one screen the app will not let anybody past.
 *
 * It appears only when this binary is older than the floor somebody has set
 * in the database on purpose, which should be rare: a build is only shut out
 * when it is genuinely broken against the server it is talking to. Everything
 * short of that is an over-the-air update, which the hook takes silently and
 * which nobody has to be told about.
 *
 * No dismissal and no "later". A "later" on a wall like this means a chef
 * declaring work into a version whose writes the server has stopped
 * accepting, and finding out at the end of the week.
 */
export function UpdateWall({ children }: { children: React.ReactNode }) {
  const { state, note } = useRequiredUpdate();
  const { t } = useI18n();
  const theme = useTheme();

  if (state !== 'store') return <>{children}</>;

  return (
    <ThemedView style={styles.page}>
      <View style={[styles.badge, { backgroundColor: theme.backgroundGroup }]}>
        <Ionicons name="arrow-down-circle-outline" size={40} color={theme.textSecondary} />
      </View>
      <ThemedText type="subtitle" style={styles.centre}>{t.update.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.centre}>
        {note ?? t.update.body}
      </ThemedText>
      <Action large label={t.update.action} onPress={() => { void Linking.openURL(STORE_URL); }} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.centre}>
        {t.update.current(APP_VERSION)}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  badge: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  centre: {
    textAlign: 'center',
  },
});
