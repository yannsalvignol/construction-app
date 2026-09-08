import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

export const KEYBOARD_DONE_BAR_ID = 'keyboard-done-bar';

/**
 * iOS only: some keyboard types (email-address, numeric, etc.) have no
 * built-in way to dismiss them, so this renders a "Done" bar above the
 * keyboard. Pair it with `inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}` on
 * each TextInput. Android's keyboard already has a default dismiss
 * affordance, so this renders nothing there.
 */
export function KeyboardDoneBar() {
  const theme = useTheme();
  const { t } = useI18n();

  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_BAR_ID}>
      <ThemedView
        style={[
          styles.bar,
          { backgroundColor: theme.backgroundSelected, borderTopColor: theme.backgroundSelected },
        ]}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={Spacing.two}>
          <ThemedText type="smallBold" themeColor="text">
            {t.common.done}
          </ThemedText>
        </Pressable>
      </ThemedView>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
