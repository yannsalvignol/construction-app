import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/** One full swing, there and back. */
const CYCLE_MS = 2800;
/** How far the capsule tips, in degrees. */
const TILT = 9;
/**
 * How far behind the tilt the ball runs, as a fraction of the cycle. The ball
 * is moved by the slope, so it can only ever arrive after it.
 */
const LAG = 0.12;

/**
 * The brand mark, animated: the capsule rocks like a spirit level and the ball
 * rolls to whichever end is lower. Both are driven by one clock running at a
 * constant rate, so the motion never stops or restarts — the easing is in the
 * shape of the wave rather than in a sequence of timings.
 *
 * Drawn from views rather than an image so it can articulate, and so it takes
 * its colours from the theme.
 *
 * `size` is the capsule's width; everything else is derived from it.
 */
export function LevelMark({ size = 132 }: { size?: number }) {
  const theme = useTheme();

  const height = size * 0.38;
  const ball = height * 0.58;
  const travel = (size - ball) / 2 - height * 0.12;

  // Advanced by the frame clock rather than by a repeating animation: a
  // withRepeat restarts its timing each cycle, and that restart is a frame the
  // motion sits still for. Accumulating elapsed time has no seam to sit on.
  const clock = useSharedValue(0);
  useFrameCallback((frame) => {
    'worklet';
    const elapsed = frame.timeSincePreviousFrame ?? 16;
    clock.value = (clock.value + elapsed / CYCLE_MS) % 1;
  });

  // A sine gives the ease at each end for free, and never pauses at the middle.
  const tilt = useDerivedValue(() => Math.sin(clock.value * 2 * Math.PI));
  const roll = useDerivedValue(() => Math.sin((clock.value - LAG) * 2 * Math.PI));

  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${tilt.value * TILT}deg` }],
  }));

  // A plain circle has no visible orientation, so rotating it would show
  // nothing: the roll is read from the travel alone.
  const ballStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: roll.value * travel }],
  }));

  return (
    <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.capsule,
          { width: size, height, borderRadius: height / 2, backgroundColor: theme.text },
          capsuleStyle,
        ]}>
        <Animated.View
          style={[
            styles.ball,
            { width: ball, height: ball, borderRadius: ball / 2, backgroundColor: theme.background },
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
  capsule: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ball: {},
});
