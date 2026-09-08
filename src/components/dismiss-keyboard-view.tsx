import { Keyboard, TouchableWithoutFeedback } from 'react-native';

import { ThemedView, type ThemedViewProps } from '@/components/themed-view';

/**
 * Drop-in replacement for a form screen's root ThemedView that also dismisses
 * the keyboard when the user taps outside a focused TextInput. The child must
 * stay a single element that forwards props to a host view, since
 * TouchableWithoutFeedback clones it to attach the touch handlers.
 */
export function DismissKeyboardView({ children, ...props }: ThemedViewProps) {
  return (
    <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()} accessible={false}>
      <ThemedView {...props}>{children}</ThemedView>
    </TouchableWithoutFeedback>
  );
}
