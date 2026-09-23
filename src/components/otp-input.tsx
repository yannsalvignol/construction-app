import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const CELL_COUNT = 6;

/**
 * Six digit boxes fed by one hidden field: a real keyboard-backed input is what
 * makes paste, backspace and the one-time-code autofill work, which per-box
 * inputs famously break. The boxes are only a drawing of its value.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const completed = useRef('');

  useEffect(() => {
    if (value.length === CELL_COUNT && completed.current !== value) {
      completed.current = value;
      onComplete?.(value);
    }
    if (value.length < CELL_COUNT) completed.current = '';
  }, [value, onComplete]);

  return (
    <Pressable
      accessibilityRole="none"
      onPress={() => input.current?.focus()}
      style={styles.row}>
      {Array.from({ length: CELL_COUNT }, (_, index) => (
        <Cell
          key={index}
          digit={value[index] ?? ''}
          // The cell after the last digit is the one being typed into; once the
          // code is complete every cell is settled, so none is highlighted.
          active={focused && !disabled && index === Math.min(value.length, CELL_COUNT - 1) && value.length < CELL_COUNT}
        />
      ))}

      <TextInput
        ref={input}
        value={value}
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, CELL_COUNT))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        // Lets iOS and Android offer the code straight from the message.
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={CELL_COUNT}
        caretHidden
        style={styles.hidden}
        accessibilityLabel="Code"
      />
    </Pressable>
  );
}

function Cell({ digit, active }: { digit: string; active: boolean }) {
  const theme = useTheme();
  const on = useDerivedValue(() => withTiming(active ? 1 : 0, { duration: 140 }));
  const filled = useDerivedValue(() => withSpring(digit ? 1 : 0, { damping: 18, stiffness: 240 }));

  const boxStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(on.value, [0, 1], ['transparent', theme.accent]),
    transform: [{ scale: 1 + on.value * 0.04 }],
  }));
  const digitStyle = useAnimatedStyle(() => ({
    opacity: filled.value,
    transform: [{ translateY: (1 - filled.value) * 8 }],
  }));

  return (
    <Animated.View style={[styles.cell, { backgroundColor: theme.backgroundInput }, boxStyle]}>
      <Animated.View style={digitStyle}>
        <ThemedText style={styles.digit}>{digit}</ThemedText>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cell: {
    flex: 1,
    height: 60,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontSize: 26,
    fontWeight: '600',
  },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    // Keeps the caret and any system UI off-screen while the field stays focusable.
    fontSize: 1,
  },
});
