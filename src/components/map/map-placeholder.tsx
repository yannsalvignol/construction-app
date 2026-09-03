import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

/**
 * Stand-in for the web build. react-native-maps has no web implementation, so
 * the browser gets a card in the same shape as the native map rather than a
 * broken bundle.
 */
export function MapPlaceholder({ title }: { title: string }) {
  const theme = useTheme();
  const { t } = useI18n();

  return (
    <View style={styles.screen}>
      <View style={[styles.card, { borderColor: theme.backgroundSelected }]}>
        <SymbolView
          name={{ ios: 'map', android: 'map', web: 'map' }}
          size={28}
          tintColor={theme.textSecondary}
        />
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
          {t.map.webUnavailable}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 28,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  text: {
    textAlign: 'center',
  },
});
