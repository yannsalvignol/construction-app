import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ExtraTasks } from './extra-tasks';
import { TaskForm } from './task-form';
import { ThemedText } from './themed-text';
import { Card } from './work-ui';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import type { Workspace } from '@/lib/presence';
import { workCopy } from '@/lib/work-copy';

type Mode = 'list' | 'write';

/**
 * Everything that is not on the devis, in one card.
 *
 * It was two: a catalogue behind one heading, a blank box behind another,
 * each with a sentence explaining itself. But a man who has just done
 * something is not choosing between two features — he is answering one
 * question, "what else did you do", and whether the answer happens to have a
 * code is a detail of ours, not of his day. So: one card, and two ways to
 * answer inside it.
 *
 * The list comes first because most answers are in it, and the quantities it
 * collects are what the chef counts. Writing is there for the week a chantier
 * invents something new.
 */
export function OtherWork({ data, dayId, onSaved }: {
  data: Workspace;
  dayId: string;
  onSaved: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('list');

  return (
    <Card>
      <ThemedText type="smallBold">{copy.otherWorkTitle}</ThemedText>

      {/* Two ways in, shown side by side rather than hidden behind each
          other: whichever he needs, he can see it without opening anything. */}
      <View style={styles.pills}>
        {([['list', copy.otherFromList], ['write', copy.otherWrite]] as const).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === key }}
            onPress={() => setMode(key)}
            style={({ pressed }) => [
              styles.pill,
              {
                backgroundColor: mode === key ? theme.accent : theme.backgroundInput,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: mode === key ? theme.buttonText : theme.textSecondary }}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {mode === 'list'
        ? <TaskForm data={data} onSaved={onSaved} />
        : <ExtraTasks dayId={dayId} onSaved={onSaved} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  pills: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
});
