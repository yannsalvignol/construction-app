import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

const AnimatedText = Animated.createAnimatedComponent(ThemedText);

export type Country = {
  code: string;
  name: string;
  dialCode: string;
  /** How the national number is grouped for reading, digit counts in order. */
  groups: number[];
};

/**
 * Morocco and France lead because that is where the crews are; the rest covers
 * the countries workers on those sites most often carry a number from.
 */
export const COUNTRIES: Country[] = [
  { code: 'MA', name: 'Maroc', dialCode: '+212', groups: [1, 2, 2, 2, 2] },
  { code: 'FR', name: 'France', dialCode: '+33', groups: [1, 2, 2, 2, 2] },
  { code: 'ES', name: 'Espagne', dialCode: '+34', groups: [3, 3, 3] },
  { code: 'PT', name: 'Portugal', dialCode: '+351', groups: [3, 3, 3] },
  { code: 'IT', name: 'Italie', dialCode: '+39', groups: [3, 3, 4] },
  { code: 'BE', name: 'Belgique', dialCode: '+32', groups: [3, 2, 2, 2] },
  { code: 'CH', name: 'Suisse', dialCode: '+41', groups: [2, 3, 2, 2] },
  { code: 'DE', name: 'Allemagne', dialCode: '+49', groups: [3, 4, 4] },
  { code: 'NL', name: 'Pays-Bas', dialCode: '+31', groups: [1, 8] },
  { code: 'GB', name: 'Royaume-Uni', dialCode: '+44', groups: [4, 6] },
  { code: 'DZ', name: 'Algérie', dialCode: '+213', groups: [3, 2, 2, 2] },
  { code: 'TN', name: 'Tunisie', dialCode: '+216', groups: [2, 3, 3] },
  { code: 'MR', name: 'Mauritanie', dialCode: '+222', groups: [2, 2, 2, 2] },
  { code: 'SN', name: 'Sénégal', dialCode: '+221', groups: [2, 3, 2, 2] },
  { code: 'CI', name: "Côte d'Ivoire", dialCode: '+225', groups: [2, 2, 2, 2, 2] },
  { code: 'ML', name: 'Mali', dialCode: '+223', groups: [2, 2, 2, 2] },
  { code: 'EG', name: 'Égypte', dialCode: '+20', groups: [3, 3, 4] },
  { code: 'AE', name: 'Émirats arabes unis', dialCode: '+971', groups: [2, 3, 4] },
  { code: 'SA', name: 'Arabie saoudite', dialCode: '+966', groups: [2, 3, 4] },
  { code: 'TR', name: 'Turquie', dialCode: '+90', groups: [3, 3, 2, 2] },
  { code: 'US', name: 'États-Unis', dialCode: '+1', groups: [3, 3, 4] },
  { code: 'CA', name: 'Canada', dialCode: '+1', groups: [3, 3, 4] },
];

const DEFAULT = COUNTRIES[0];

/** Regional indicator pair, which every platform renders as the flag. */
function flag(code: string) {
  return String.fromCodePoint(
    0x1f1e6 + (code.charCodeAt(0) - 65),
    0x1f1e6 + (code.charCodeAt(1) - 65)
  );
}

const digitsOf = (value: string) => value.replace(/\D/g, '');
const capacity = (country: Country) => country.groups.reduce((sum, n) => sum + n, 0);

/** Splits the digits into the country's groups, keeping any overflow at the end. */
function format(digits: string, country: Country) {
  const parts: string[] = [];
  let rest = digits;
  for (const size of country.groups) {
    if (!rest) break;
    parts.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  if (rest) parts.push(rest);
  return parts.join(' ');
}

/** The country whose dial code the stored number starts with, longest first. */
function countryOf(stored: string) {
  const matches = COUNTRIES.filter((c) => stored.startsWith(c.dialCode));
  return matches.sort((a, b) => b.dialCode.length - a.dialCode.length)[0];
}

/**
 * Phone field with a country picker. The value is stored in international form
 * (`+212612345678`) so it is unambiguous wherever it is read, and shown grouped
 * the way that country's numbers are written, so it can be checked at a glance.
 *
 * Matches AnimatedInput's shape and behaviour: same height, same floating
 * label, same focus ring.
 */
export function PhoneInput({
  label,
  value,
  onChangeText,
  surface,
  labelColor,
}: {
  label: string;
  /** International form, or empty. */
  value: string;
  onChangeText: (value: string) => void;
  /** Overrides the field's fill, to match the rest of a screen's form. */
  surface?: string;
  /** Overrides the resting label colour, to go with `surface`. */
  labelColor?: string;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  // A country chosen before any digit exists cannot be read back out of the
  // value — an empty number carries no dial code — so the choice is held here
  // until there is something to store it in.
  const [picked, setPicked] = useState<Country | null>(null);

  const country = countryOf(value) ?? picked ?? DEFAULT;
  const national = value.startsWith(country.dialCode) ? value.slice(country.dialCode.length) : '';
  const shown = format(national, country);

  const filled = national.length > 0;
  const raised = useDerivedValue(() => withTiming(focused || filled ? 1 : 0, { duration: 160 }));
  const active = useDerivedValue(() => withTiming(focused ? 1 : 0, { duration: 160 }));

  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(raised.value, [0, 1], [0, -11]) },
      { scale: interpolate(raised.value, [0, 1], [1, 0.82]) },
    ],
  }));
  const labelTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(active.value, [0, 1], [labelColor ?? theme.textPlaceholder, theme.accentText]),
  }));
  const boxStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(active.value, [0, 1], ['transparent', theme.accent]),
  }));

  function setCountry(next: Country) {
    setPickerOpen(false);
    setSearch('');
    setPicked(next);
    // The digits are kept: changing the country re-reads the same number under
    // a different code rather than making someone type it again.
    onChangeText(national ? `${next.dialCode}${national.slice(0, capacity(next))}` : '');
  }

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return COUNTRIES;
    return COUNTRIES.filter((c) =>
      c.name.toLowerCase().includes(needle) ||
      c.code.toLowerCase().includes(needle) ||
      c.dialCode.includes(needle)
    );
  }, [search]);

  return (
    <>
      {/* Two bubbles rather than one box split by a rule: the country is a
          separate choice from the number, and it reads as one. */}
      <View style={styles.fieldRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${country.name} ${country.dialCode}`}
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [
            styles.countryBox,
            { backgroundColor: surface ?? theme.backgroundInput },
            pressed && styles.pressed,
          ]}>
          <ThemedText style={styles.flag}>{flag(country.code)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{country.dialCode}</ThemedText>
          <Ionicons name="chevron-down" size={14} color={labelColor ?? theme.textPlaceholder} />
        </Pressable>

        <Animated.View style={[styles.box, { backgroundColor: surface ?? theme.backgroundInput }, boxStyle]}>
          <View style={styles.field}>
          <Animated.View pointerEvents="none" style={[styles.labelBox, labelStyle]}>
            <AnimatedText type="small" style={labelTextStyle}>{label}</AnimatedText>
          </Animated.View>
          <TextInput
            allowFontScaling={false}
            value={shown}
            onChangeText={(next) => {
              const digits = digitsOf(next).slice(0, capacity(country));
              onChangeText(digits ? `${country.dialCode}${digits}` : '');
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
              style={[styles.input, { color: theme.text }]}
            />
          </View>
        </Animated.View>
      </View>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={styles.sheetHeader}>
            <ThemedText type="subtitle" style={{ flex: 1 }}>{t.account.profile.countryTitle}</ThemedText>
            <Pressable
              onPress={() => setPickerOpen(false)}
              hitSlop={10}
              accessibilityLabel={t.common.cancel}
              style={({ pressed }) => pressed && styles.pressed}>
              <Ionicons name="close" size={26} color={theme.text} />
            </Pressable>
          </View>

          <TextInput
            allowFontScaling={false}
            value={search}
            onChangeText={setSearch}
            placeholder={t.account.profile.countrySearch}
            placeholderTextColor={theme.textPlaceholder}
            autoCorrect={false}
            style={[styles.search, { backgroundColor: theme.backgroundInput, color: theme.text }]}
          />

          <FlatList
            data={results}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {t.account.profile.countryEmpty}
              </ThemedText>
            }
            renderItem={({ item }) => {
              const selected = item.code === country.code;
              return (
                <Pressable
                  onPress={() => setCountry(item)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <ThemedText style={styles.flag}>{flag(item.code)}</ThemedText>
                  <ThemedText style={{ flex: 1 }}>{item.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{item.dialCode}</ThemedText>
                  {selected && <Ionicons name="checkmark" size={18} color={theme.accentText} />}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  box: {
    flex: 1,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  countryBox: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    // A border of its own width, transparent, so the bubble stays the same
    // height as the field beside it, which gains one on focus.
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  flag: {
    fontSize: 20,
  },
  field: {
    flex: 1,
    alignSelf: 'stretch',
  },
  labelBox: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    transformOrigin: 'left center',
  },
  input: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 6,
    height: 22,
    fontSize: 16,
    paddingVertical: 0,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  search: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: 44,
    fontSize: 16,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  empty: {
    paddingVertical: Spacing.four,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
