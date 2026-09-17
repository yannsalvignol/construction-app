import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Row primitives shared by the Compte and Réglages screens. */

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={[styles.infoRow, styles.transparent]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

export function LinkRow({
  label,
  note,
  onPress,
}: {
  label: string;
  note: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.transparent}>
      <Pressable
        style={({ pressed }) => [styles.infoRow, pressed && styles.pressed]}
        onPress={onPress}>
        <ThemedText type="small">{label}</ThemedText>
        <Ionicons name="chevron-forward" size={15} color={theme.textSecondary} />
      </Pressable>
      {note && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.linkNote}>
          {note}
        </ThemedText>
      )}
    </ThemedView>
  );
}

/** Single-choice pill group (language, appearance). */
export function PillChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const theme = useTheme();
  return (
    <ThemedView style={[styles.pillRow, styles.transparent]}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={({ pressed }) => pressed && styles.pressed}
            onPress={() => onChange(option.key)}>
            <ThemedView
              style={[
                styles.pill,
                {
                  backgroundColor: 'transparent',
                  borderColor: selected ? theme.accent : theme.backgroundSelected,
                },
              ]}>
              <ThemedText type="small" themeColor={selected ? 'accentText' : 'textSecondary'}>
                {option.label}
              </ThemedText>
            </ThemedView>
          </Pressable>
        );
      })}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
  linkNote: {
    paddingBottom: Spacing.two,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  pill: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
