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
  // The selected tab is the raised one: it takes the element colour (white in
  // light mode) against a row that is otherwise the page's own background, so
  // the row reads as part of the page rather than a band of colour across it.
  const color = isFocused ? theme.text : theme.textSecondary;

  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        style={[
          styles.pill,
          {
            backgroundColor: isFocused ? theme.backgroundElement : theme.background,
            // Only the unselected pills are outlined: the selected one is told
            // apart by its filled surface, so an outline there would fight it.
            borderColor: isFocused ? 'transparent' : theme.text,
          },
        ]}>
        <Ionicons name={icon} size={16} color={color} />
        <ThemedText type="small" style={{ color }}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

// Row vertical padding (x2) + pill vertical padding (x2) + pill content line height.
export const CHEF_TAB_BAR_HEIGHT = Spacing.two * 4 + 20;

export function ChefTabList({ style, ...props }: TabListProps) {
  const theme = useTheme();

  return (
    <ScrollView
      {...props}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.bar, { backgroundColor: theme.background }]}
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
});
