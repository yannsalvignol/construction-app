import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A sheet that rises from the bottom over a dimmed page: close to where the
 * thumb already is, unlike a box in the middle of the screen, and dismissed
 * the three ways people try — the grabber, the backdrop, the back gesture.
 *
 * `icon` sets the tone of the message before it is read; `actions` are laid
 * out by the caller so a sheet can have one button or two.
 */
export function AppModal({
  visible,
  onClose,
  title,
  icon,
  iconColor,
  children,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // A tap as the sheet arrives, so it is felt as well as seen — the same cue
  // iOS gives its own sheets. Haptics have no web implementation.
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={styles.backdropLayer}>
          <Pressable
            style={styles.backdropPress}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }
              onClose();
            }}
            accessibilityElementsHidden
          />
        </Animated.View>

        <Animated.View
          entering={SlideInDown.springify().damping(20).mass(0.7)}
          exiting={SlideOutDown.duration(180)}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: Spacing.four + insets.bottom,
            },
          ]}>
          <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />

          {icon && (
            <View style={[styles.iconWrap, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name={icon} size={26} color={iconColor ?? theme.accentText} />
            </View>
          )}

          <ThemedText type="subtitle" style={styles.title}>{title}</ThemedText>

          {children}

          {actions && <View style={styles.actions}>{actions}</View>}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The sheet's own button, so callers do not restyle one every time. */
export function ModalButton({
  label,
  onPress,
  secondary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(
            secondary ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
          ).catch(() => {});
        }
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        secondary
          ? { borderWidth: 1, borderColor: theme.backgroundSelected }
          : { backgroundColor: theme.accent },
        pressed && { opacity: 0.7 },
      ]}>
      {icon && <Ionicons name={icon} size={18} color={secondary ? theme.text : theme.buttonText} />}
      <ThemedText type="smallBold" style={{ color: secondary ? theme.text : theme.buttonText }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8, 5, 16, 0.55)',
  },
  backdropPress: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.two,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
  },
  actions: {
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderRadius: Spacing.three + Spacing.one,
    paddingHorizontal: Spacing.four,
  },
});
