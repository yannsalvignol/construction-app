import { useRef } from 'react';
import { BrandSpinner } from '@/components/brand-spinner';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { ThemedText } from './themed-text';
import { useTheme } from '@/hooks/use-theme';

const ACTION_WIDTH = 108;
/** Gap between the row and the revealed button, so the two read as separate cards. */
const GAP = 8;

/** A component rather than an inline render function, so its hook is legal. */
function DeleteAction({ translation, label, busy, radius, onPress }: {
  translation: SharedValue<number>; label: string; busy?: boolean; radius: number; onPress: () => void;
}) {
  const theme = useTheme();
  // Keeps the button pinned to the right edge as the row slides past it.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value + ACTION_WIDTH + GAP }],
  }));
  return <Animated.View style={[{ width: ACTION_WIDTH + GAP }, style]}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({
        flex: 1, marginLeft: GAP, borderRadius: radius,
        backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}>
      {busy
        ? <BrandSpinner color={theme.buttonText} />
        : <ThemedText type="smallBold" style={{ color: theme.buttonText }}>{label}</ThemedText>}
    </Pressable>
  </Animated.View>;
}

/**
 * Swipe left to reveal a destructive action. The row never deletes on the swipe
 * itself: the gesture only uncovers the button, so a stray drag in a scrolling
 * list cannot remove anything.
 */
export function SwipeToDelete({ label, busy, onDelete, radius = 16, children }: {
  label: string; busy?: boolean; onDelete: () => void;
  /** Match the row being swiped so the button reads as part of the same list. */
  radius?: number;
  children: React.ReactNode;
}) {
  const row = useRef<SwipeableMethods | null>(null);

  return <ReanimatedSwipeable ref={row} friction={2} rightThreshold={40} overshootRight={false}
    renderRightActions={(_progress, translation) =>
      <DeleteAction translation={translation} label={label} busy={busy} radius={radius}
        onPress={() => { row.current?.close(); onDelete(); }} />}>
    <View>{children}</View>
  </ReanimatedSwipeable>;
}
