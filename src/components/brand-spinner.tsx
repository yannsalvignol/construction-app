import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/** One full rock, there and back. Quicker than the splash mark: this one says
 *  "working", not "welcome". */
const CYCLE_MS = 1100;
/** How far the level tips, in degrees. Wider than the splash mark, so the
 *  motion still reads at 28px. */
const TILT = 16;
/** How far behind the tilt the ball runs, as a fraction of the cycle: the
 *  slope moves the ball, so it can only ever arrive after it. */
const LAG = 0.14;

/**
 * The app's own loading indicator: the CASPROD mark as a spirit level, rocking
 * with the ball rolling to whichever end is lower. It replaces the system
 * spinner, which belongs to no particular app.
 *
 * Drawn from views rather than the SVG so it can articulate and take its
 * colours from the theme. One frame clock drives both parts, so the motion has
 * no seam to restart on.
 *
 * `size` is the mark's width. `tile` draws the rounded square from the icon
 * behind it, for the places where the loader stands alone on a page.
 */
export function BrandSpinner({
  size = 28,
  color,
  tile = false,
  alternate = false,
  cycleMs = CYCLE_MS,
}: {
  size?: number;
  /** Defaults to the accent; pass the surface colour on a filled button. */
  color?: string;
  tile?: boolean;
  /** Swaps the level's colour at each end of the travel, for a wait long
   *  enough that a purely repeating motion starts to look stuck. */
  alternate?: boolean;
  /** Slower than the default where the mark is decoration rather than a wait:
   *  the loader's pace reads as impatience when nothing is actually loading. */
  cycleMs?: number;
}) {
  const theme = useTheme();

  const bar = tile ? size * 0.66 : size;
  const height = bar * 0.34;
  const ball = height * 0.72;
  const travel = (bar - ball) / 2 - height * 0.1;
  const barColor = color ?? theme.accentText;

  const clock = useSharedValue(0);
  useFrameCallback((frame) => {
    'worklet';
    const elapsed = frame.timeSincePreviousFrame ?? 16;
    clock.value = (clock.value + elapsed / cycleMs) % 1;
  });

  // A sine eases at each end for free and never pauses in the middle.
  const tilt = useDerivedValue(() => Math.sin(clock.value * 2 * Math.PI));
  const roll = useDerivedValue(() => Math.sin((clock.value - LAG) * 2 * Math.PI));

  const levelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${tilt.value * TILT}deg` }],
    // The ball is at one end when the cosine is +1 and at the other when it is
    // -1, so interpolating on it lands the colour exactly on each bounce.
    ...(alternate
      ? {
          backgroundColor: interpolateColor(
            Math.cos((clock.value - LAG) * 2 * Math.PI),
            [-1, 1],
            [theme.accent, theme.text]
          ),
        }
      : null),
  }));
  const ballStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: roll.value * travel }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.stage,
        { width: size, height: size },
        tile && { backgroundColor: theme.backgroundInput, borderRadius: size * 0.22 },
      ]}>
      <Animated.View
        style={[
          styles.level,
          { width: bar, height, borderRadius: height / 2 },
          !alternate && { backgroundColor: barColor },
          levelStyle,
        ]}>
        {/* The bubble reads as a hole in the level, so it takes the colour of
            whatever the level is sitting on. */}
        <Animated.View
          style={[
            { width: ball, height: ball, borderRadius: ball / 2 },
            // The ball reads as a hole in the level, so it takes the colour of
            // whatever the level is sitting on.
            { backgroundColor: tile ? theme.backgroundInput : theme.background },
            ballStyle,
          ]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  level: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
