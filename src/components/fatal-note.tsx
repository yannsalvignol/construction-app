import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { Colors, Spacing } from '@/constants/theme';
import { clearFatal, readFatal } from '@/lib/crash-note';

/**
 * Shows the last fatal error, if there was one.
 *
 * Deliberately built out of nothing: plain Text, hard-coded colours, no theme
 * hook, no translation, no card component. It has to render when the rest of
 * the app is the thing that is broken, so it may not depend on any of it.
 */
export function FatalNote() {
  const [text, setText] = useState(readFatal);
  if (!text) return null;
  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>Erreur à signaler</Text>
      <ScrollView style={styles.scroll}>
        {/* Selectable so a tester can copy it rather than retype it. */}
        <Text selectable style={styles.body}>{text}</Text>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        onPress={() => { clearFatal(); setText(null); }}
        style={styles.button}>
        <Text style={styles.buttonLabel}>Fermer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '70%',
    backgroundColor: '#1B1626',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    zIndex: 9999,
  },
  title: { color: Colors.dark.warning, fontSize: 15, fontWeight: '700' },
  scroll: { flexGrow: 0 },
  body: { color: '#F5F0FC', fontSize: 12, fontFamily: 'Courier' },
  button: {
    backgroundColor: Colors.dark.backgroundSelected,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonLabel: { color: '#F5F0FC', fontSize: 14, fontWeight: '600' },
});
