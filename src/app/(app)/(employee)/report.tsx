import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { QuoteTasks } from '@/components/quote-tasks';
import { ExtraTasks } from '@/components/extra-tasks';
import { TaskForm } from '@/components/task-form';
import { Action, Feedback, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { useWorkspace } from '@/hooks/use-workspace';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { workCopy } from '@/lib/work-copy';

export default function TasksScreen() {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const copy = workCopy(locale);
  const { data, loading, error, refresh, now } = useWorkspace();
  const active = data?.day && !data.day.ended_at && Date.parse(data.day.planned_end_at) > now;
  // Closed by default: the devis is the work, and the catalogue is the
  // exception. Open it and it stays open for the rest of the visit.
  const [otherOpen, setOtherOpen] = useState(false);
  // Same arrangement for the third list, which is not a list: closed until
  // there is something the other two could not hold.
  const [extraOpen, setExtraOpen] = useState(false);

  return <WorkPage title={copy.taskTitle}>
    {loading && <ThemedText>{copy.loading}</ThemedText>}
    <Feedback message={error} />
    {error && <Action label={copy.retry} onPress={() => { void refresh(); }} />}
    {data && (active ? <>
      {/* The chantier's devis is the task list: the work that was actually
          sold, in the words the chef quoted. The catalogue is not another list
          of the same standing — it is for the job nobody quoted, so it waits
          behind a heading instead of competing with the real one. */}
      {data.day && <QuoteTasks dayId={data.day.id} onSaved={refresh} />}

      {/* The heading is bare, not a card: TaskForm brings its own, and a card
          inside a card reads as two objects where there is one. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: otherOpen }}
        onPress={() => setOtherOpen((current) => !current)}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
          pressed && { opacity: 0.6 },
        ]}>
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText type="smallBold">{t.quoteTasks.otherWork}</ThemedText>
          {!otherOpen && (
            <ThemedText type="small" themeColor="textSecondary">{t.quoteTasks.otherWorkHint}</ThemedText>
          )}
        </View>
        <Ionicons
          name={otherOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.textSecondary}
        />
      </Pressable>
      {otherOpen && <TaskForm data={data} onSaved={refresh} />}

      {/* And the third case: work that is in neither list. Last, because it
          is the exception to both — but on the same page, because a man who
          cannot find what he did will declare the nearest wrong thing. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: extraOpen }}
        onPress={() => setExtraOpen((current) => !current)}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
          pressed && { opacity: 0.6 },
        ]}>
        <View style={{ flex: 1, gap: 2 }}>
          <ThemedText type="smallBold">{copy.extraTitle}</ThemedText>
          {!extraOpen && (
            <ThemedText type="small" themeColor="textSecondary">{copy.extraHint}</ThemedText>
          )}
        </View>
        <Ionicons
          name={extraOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.textSecondary}
        />
      </Pressable>
      {extraOpen && data.day && <ExtraTasks dayId={data.day.id} onSaved={refresh} />}
    </> : <ThemedText themeColor="textSecondary">{copy.startForTasks}</ThemedText>)}
  </WorkPage>;
}
