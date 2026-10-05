import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The company name, always in the brand face and always followed by its dot.
 *
 * Capitalised, not shouted. CASPROD in full caps read as an acronym for
 * something, and the three places it appears — the store, the home screen,
 * this wordmark — each spelled it differently, which is the one thing a name
 * may not do.
 *
 * Plain Text rather than ThemedText on purpose: ThemedText always applies a
 * size, which would override the line this sits in. With only a family set,
 * nested text inherits the size, weight and colour of its parent, so the name
 * looks right in a 30px header and in a sentence alike.
 *
 * `dot={false}` for the rare place that supplies its own punctuation.
 */
export function BrandName({ dot = true }: { dot?: boolean }) {
  const theme = useTheme();
  return (
    <>
      <Text allowFontScaling={false} style={styles.name}>Casprod</Text>
      {dot && <Text allowFontScaling={false} style={[styles.name, { color: theme.accent }]}>.</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  name: {
    fontFamily: 'SpaceGrotesk_700Bold',
  },
});
