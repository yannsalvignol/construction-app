import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The company name, always in the brand face and always followed by its dot.
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
      <Text allowFontScaling={false} style={styles.name}>CASPROD</Text>
      {dot && <Text allowFontScaling={false} style={[styles.name, { color: theme.accent }]}>.</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  name: {
    fontFamily: 'SpaceGrotesk_700Bold',
  },
});
