import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import { Card } from './work-ui';
import { useTheme } from '@/hooks/use-theme';

/**
 * A heading that opens into the thing it names, inside one card.
 *
 * The two of these on the Tâches tab used to be bare rows of text with a
 * chevron, sitting above cards of their own: nothing said they could be
 * pressed until you had pressed one, and open they read as two objects
 * rather than a heading and its contents. One surface now, with the icon
 * carrying what the section is before the words are read — which on a
 * chantier, in gloves, in the sun, is most of what gets read.
 *
 * The hint is shown only while it is closed. Once a man is looking at the
 * form, telling him what the form is for is noise in front of it.
 */
export function Disclosure({ icon, title, hint, open, onToggle, children }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        accessibilityHint={hint}
        onPress={onToggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View
          style={[
            styles.badge,
            { backgroundColor: open ? theme.accentSoft : theme.backgroundGroup },
          ]}>
          <Ionicons name={icon} size={20} color={open ? theme.accentText : theme.textSecondary} />
        </View>
        <View style={styles.words}>
          <ThemedText type="smallBold">{title}</ThemedText>
          {!open && !!hint && (
            <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText>
          )}
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.textSecondary}
        />
      </Pressable>

      {open && (
        <>
          <View style={[styles.rule, { backgroundColor: theme.backgroundSelected }]} />
          {children}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: {
    flex: 1,
    gap: 2,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.6,
  },
});
