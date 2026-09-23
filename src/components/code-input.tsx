import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One box per character, filled left to right — the shape people know from
 * verification codes, which also makes a six-character code readable when
 * dictated over the phone.
 *
 * A single hidden TextInput sits over the boxes and holds the whole value:
 * auto-advance, backspace, autofill and paste are then the platform's own
 * behaviour rather than per-box focus juggling.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus = false,
  hasError = false,
  /** Characters accepted; anything else typed is dropped. */
  allowed = /[A-Z0-9]/,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  hasError?: boolean;
  allowed?: RegExp;
  accessibilityLabel?: string;
}) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const characters = value.split('');
  const activeIndex = Math.min(value.length, length - 1);

  function handleChange(next: string) {
    const cleaned = next.toUpperCase().split('').filter((c) => allowed.test(c)).join('').slice(0, length);
    if (cleaned === value) return;
    onChange(cleaned);
    if (cleaned.length === length) onComplete?.(cleaned);
  }

  return (
    <Pressable accessible={false} onPress={() => input.current?.focus()} style={styles.container}>
      <View style={styles.boxes}>
        {Array.from({ length }, (_, index) => (
          <Box
            key={index}
            character={characters[index]}
            active={focused && index === activeIndex && value.length < length}
            filled={index < value.length}
            hasError={hasError}
            reduceMotion={reduceMotion}
          />
        ))}
      </View>
      {/* Transparent and on top: taps land on the boxes, the caret is ours. */}
      <TextInput
        ref={input}
        style={styles.hidden}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        maxLength={length}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        keyboardType="default"
        caretHidden
        selectionColor="transparent"
        accessibilityLabel={accessibilityLabel}
      />
    </Pressable>
  );
}

function Box({ character, active, filled, hasError, reduceMotion }: {
  character?: string; active: boolean; filled: boolean; hasError: boolean; reduceMotion: boolean;
}) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const caret = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) { scale.value = 1; return; }
    scale.value = active ? withSpring(1.06, { damping: 14, mass: 0.5 }) : withSpring(1, { damping: 16 });
  }, [active, reduceMotion, scale]);

  useEffect(() => {
    if (!active || reduceMotion) { caret.value = active ? 1 : 0; return; }
    caret.value = withRepeat(withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 500 })), -1, true);
  }, [active, reduceMotion, caret]);

  const boxStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.value }));

  const borderColor = hasError ? theme.danger : active ? theme.accent : filled ? theme.accentText : theme.backgroundSelected;

  return (
    <Animated.View
      style={[
        styles.box,
        boxStyle,
        { borderColor, backgroundColor: active ? theme.accentSoft : theme.backgroundElement, borderWidth: active || filled ? 2 : 1 },
      ]}>
      {character ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(120)}>
          <ThemedText style={styles.character}>{character}</ThemedText>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.caret, caretStyle, { backgroundColor: theme.accent }]} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  boxes: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
  box: {
    flex: 1,
    maxWidth: 56,
    aspectRatio: 0.78,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  character: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  caret: { width: 2, height: 24, borderRadius: 1 },
  hidden: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, color: 'transparent', fontSize: 1 },
});
