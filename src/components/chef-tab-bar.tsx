import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TabListProps, TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ChefTabButtonProps = TabTriggerSlotProps & {
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

export function ChefTabButton({ children, isFocused, icon, ...props }: ChefTabButtonProps) {
  const theme = useTheme();
  const color = isFocused ? theme.accentText : theme.textSecondary;

  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        style={[
          styles.pill,
          {
            backgroundColor: isFocused ? theme.accentSoft : theme.backgroundElement,
            borderColor: isFocused ? theme.accent : theme.backgroundSelected,
          },
        ]}>
        <Ionicons name={icon} size={16} color={color} />
        <ThemedText type="small" themeColor={isFocused ? 'accentText' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

// Row vertical padding (x2) + pill vertical padding (x2) + pill content line height.
export const CHEF_TAB_BAR_HEIGHT = Spacing.two * 4 + 20;

export function ChefTabList({ style, hidden, ...props }: TabListProps & { hidden?: boolean }) {
  const theme = useTheme();

  return (
    <ScrollView
      {...props}
      horizontal
      showsHorizontalScrollIndicator={false}
      pointerEvents={hidden ? 'none' : 'auto'}
      style={[styles.bar, { backgroundColor: theme.background }, hidden && styles.hidden]}
      contentContainerStyle={[style, styles.container]}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pressed: {
    opacity: 0.7,
  },
  hidden: {
    opacity: 0,
  },
});
