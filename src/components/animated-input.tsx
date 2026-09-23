import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
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
import { workCopy } from '@/lib/work-copy';

const AnimatedText = Animated.createAnimatedComponent(ThemedText);

/**
 * Text field with a leading icon and a label that floats above the value once
 * the field is focused or filled. The label doubles as the placeholder, so the
 * field still says what it is after something has been typed into it — on a
 * form of near-identical boxes that is the difference between confidence and
 * a guess.
 *
 * `password` adds the reveal toggle from PasswordInput: typing a password
 * blind, on site and often with gloves, is where most sign-in failures start.
 */
export function AnimatedInput({
  label,
  icon,
  value,
  password = false,
  style,
  onFocus,
  onBlur,
  ref,
  ...props
}: TextInputProps & {
  label: string;
  /** Optional leading icon; omitted where the label alone is enough. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  value: string;
  password?: boolean;
  ref?: React.Ref<TextInput>;
}) {
  const theme = useTheme();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // One driver for both animations: 0 = resting, 1 = focused or filled.
  const raised = useDerivedValue(() =>
    withTiming(focused || value.length > 0 ? 1 : 0, { duration: 160 })
  );
  const active = useDerivedValue(() => withTiming(focused ? 1 : 0, { duration: 160 }));

  // At rest the label sits centred in the box, exactly where the value will
  // appear; raised, it moves up into the top padding.
  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(raised.value, [0, 1], [0, -11]) },
      { scale: interpolate(raised.value, [0, 1], [1, 0.82]) },
    ],
  }));

  const labelTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(active.value, [0, 1], [theme.textPlaceholder, theme.accentText]),
  }));

  // Filled field, like the other inputs; the ring only appears on focus.
  const boxStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(active.value, [0, 1], ['transparent', theme.accent]),
  }));

  return (
    <Animated.View style={[styles.box, { backgroundColor: theme.backgroundInput }, boxStyle]}>
      {icon && <Ionicons name={icon} size={20} color={focused ? theme.accentText : theme.textPlaceholder} />}

      <View style={styles.field}>
        {/* pointerEvents none: tapping the label must reach the input underneath. */}
        <Animated.View pointerEvents="none" style={[styles.labelBox, labelStyle]}>
          <AnimatedText type="small" style={labelTextStyle}>
            {label}
          </AnimatedText>
        </Animated.View>
        <TextInput
          ref={ref}
          {...props}
          value={value}
          secureTextEntry={password && !revealed}
          autoCapitalize={password ? 'none' : props.autoCapitalize}
          autoCorrect={password ? false : props.autoCorrect}
          placeholder={undefined}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          style={[styles.input, { color: theme.text }, style]}
        />
      </View>

      {password && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={revealed ? copy.hidePassword : copy.showPassword}
          onPress={() => setRevealed(!revealed)}
          hitSlop={12}>
          <Ionicons
            name={revealed ? 'eye-off-outline' : 'eye-outline'}
            size={20}
            color={theme.textPlaceholder}
          />
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
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
});
