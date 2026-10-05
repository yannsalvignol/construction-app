import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

/**
 * Lowercased and stripped of accents, so Boutaïna is found by typing
 * boutaina. A chef looking for one man among fifty-eight will not stop to
 * find the ï.
 */
export const fold = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Split on anything that is not a letter or a digit, so Al-Manar is two
 *  words and O'Brien is two: a chef typing "manar" means the second one. */
export const wordsOf = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Whether some word of `text` begins with `word`.
 *
 * From the start of a word, never from the middle of one: typing "a" should
 * offer the people whose name begins with an A, not every name that happens
 * to contain one — which on the first keystroke is almost all of them, and
 * makes the field look as though it is not working.
 */
export const begins = (text: string, word: string) =>
  wordsOf(text).some((part) => part.startsWith(word));

/** The query as words, in any order: "alaoui karim" and "kar ala" both find
 *  Karim Alaoui. */
export const terms = (query: string) => wordsOf(query);

/**
 * One search field, used by the lists long enough to need one.
 *
 * Not a form field: it carries no label and no validation, it filters what is
 * already on screen as the chef types, and the cross clears it in one tap
 * rather than making him hold backspace.
 */
export function SearchField({ value, onChange, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const theme = useTheme();
  const palette = useAuthPalette();
  const { t } = useI18n();

  return (
    <View
      style={[
        styles.field,
        { backgroundColor: palette.field, borderColor: theme.backgroundSelected },
      ]}>
      <Ionicons name="search" size={18} color={theme.textSecondary} />
      <TextInput
        style={[styles.input, { color: theme.text }]}
        // The app's type does not follow the phone's text size; neither does this.
        allowFontScaling={false}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        // The platform cross sits too close to the edge and only appears while
        // editing; this one is always there once there is something to clear.
        clearButtonMode="never"
      />
      {value.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.cancel}
          hitSlop={10}
          onPress={() => onChange('')}>
          <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    minHeight: 46,
  },
  input: {
    flex: 1,
    fontSize: 16,
    // The field's own padding carries the height; a TextInput's default
    // vertical padding differs between the platforms and would fight it.
    paddingVertical: 0,
  },
});
