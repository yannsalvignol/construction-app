import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const AnimatedIcon = Animated.createAnimatedComponent(Ionicons);

/**
 * A checkbox that is worth ticking: the box springs as it fills and the mark
 * is drawn in rather than appearing. It is used where the tick is a decision
 * rather than a setting — agreeing to how someone's location is collected —
 * so the interaction is meant to feel deliberate, and it answers with a haptic.
 *
 * `indeterminate` draws a dash instead of a tick, for a "select all" that is
 * only partly true.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  indeterminate = false,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Rendered beside the box and part of the same touch target. */
  label?: string;
  disabled?: boolean;
  indeterminate?: boolean;
}) {
  const theme = useTheme();
  const on = indeterminate || checked;

  const fill = useDerivedValue(() => withSpring(on ? 1 : 0, { damping: 15, stiffness: 220 }));
  const press = useSharedValue(0);

  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fill.value, [0, 1], ['rgba(0,0,0,0)', theme.accent]),
    borderColor: interpolateColor(fill.value, [0, 1], [theme.textPlaceholder, theme.accent]),
    // A small overshoot on the way in, and a dip while held.
    transform: [{ scale: interpolate(fill.value, [0, 0.6, 1], [1, 1.12, 1]) * (1 - press.value * 0.1) }],
  }));

  const markStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [
      { scale: interpolate(fill.value, [0, 1], [0.3, 1]) },
      { rotate: `${interpolate(fill.value, [0, 1], [-25, 0])}deg` },
    ],
  }));

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled || !onCheckedChange}
      hitSlop={6}
      /* eslint-disable-next-line react-hooks/immutability -- writing a shared
         value from a handler is how Reanimated drives an animation. */
      onPressIn={() => { press.value = withTiming(1, { duration: 90 }); }}
      // eslint-disable-next-line react-hooks/immutability -- as above.
      onPressOut={() => { press.value = withTiming(0, { duration: 140 }); }}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onCheckedChange?.(!checked);
      }}
      style={[styles.row, disabled && styles.disabled]}>
      <Animated.View style={[styles.box, boxStyle]}>
        <AnimatedIcon
          name={indeterminate ? 'remove' : 'checkmark'}
          size={18}
          color={theme.buttonText}
          style={markStyle}
        />
      </Animated.View>
      {!!label && (
        <View style={styles.labelBox}>
          <ThemedText style={styles.label}>{label}</ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelBox: {
    flex: 1,
  },
  label: {
    fontWeight: '500',
  },
  disabled: {
    opacity: 0.5,
  },
});
