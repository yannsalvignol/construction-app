import { useCallback, useRef, useState } from 'react';
import { BrandSpinner } from '@/components/brand-spinner';
import { Modal, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Action, Card, Feedback, WorkPage } from './work-ui';
import { ThemedText } from './themed-text';
import { ZoneTime } from './zone-time';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { formatElapsed, unitShort, workCopy } from '@/lib/work-copy';
import type { Locale } from '@/lib/i18n/locale';
import type { TaskUnit } from '@/lib/presence';

type PastTask = { task_code: string; quantity: number; label_fr: string; label_en: string; unit: TaskUnit };
export type PastDay = {
  id: string; work_date: string; started_at: string; ended_at: string | null; planned_end_at: string;
  seconds_inside: number; seconds_outside: number; site_name: string; checks: number; tasks: PastTask[];
};

export function formatDay(workDate: string, locale: Locale) {
  return new Date(workDate).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Loads the employee's past days once, on demand. */
export function useDayHistory() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [days, setDays] = useState<PastDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true; setError(null);
    const { data, error: failure } = await supabase.rpc('work_day_history', { days_back: 30 });
    if (failure) setError(copy.failed);
    else setDays((data ?? []) as PastDay[]);
    loading.current = false;
  }, [copy.failed]);

  return { days, error, load };
}

/**
 * The chevron beside the day heading. It offers dates, not sites: a date is the unit
 * an employee thinks in, and several work days on the same date collapse into one row.
 */
export function DayHistory({ days, error, onOpen, onPick }: {
  days: PastDay[] | null; error: string | null; onOpen: () => void; onPick: (workDate: string) => void;
}) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const dates = days
    ? [...new Set(days.map(day => day.work_date))].sort((a, b) => (a < b ? 1 : -1))
    : null;

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={copy.pickDay} hitSlop={12}
      onPress={() => { setOpen(true); onOpen(); }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name="chevron-down-outline" size={24} color={theme.textSecondary} />
    </Pressable>

    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <WorkPage title={copy.history30}>
        <Action secondary label={copy.close} onPress={() => setOpen(false)} />
        <Feedback message={error} />
        {!dates && !error && <BrandSpinner color={theme.accent} />}
        {dates && !dates.length && <Card><ThemedText>{copy.historyEmpty}</ThemedText></Card>}
        {dates?.map(date => {
          const onDate = days!.filter(day => day.work_date === date);
          return <Pressable key={date} accessibilityRole="button" accessibilityLabel={formatDay(date, locale)}
            onPress={() => { onPick(date); setOpen(false); }}
            style={({ pressed }) => pressed && { opacity: 0.6 }}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ThemedText style={{ flex: 1, fontSize: 18, fontWeight: '700' }}>{formatDay(date, locale)}</ThemedText>
                <Ionicons name="chevron-forward-outline" size={16} color={theme.textSecondary} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {formatElapsed(onDate.reduce((total, day) =>
                  total + (day.ended_at ? Date.parse(day.ended_at) : Date.parse(day.planned_end_at))
                  - Date.parse(day.started_at), 0), copy)}
              </ThemedText>
            </Card>
          </Pressable>;
        })}
      </WorkPage>
    </Modal>
  </>;
}

/** Read-only account of one past date, which may hold more than one work day. */
export function PastDayView({ days }: { days: PastDay[] }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const label = locale === 'en' ? 'label_en' : 'label_fr';

  if (!days.length) return <Card><ThemedText>{copy.historyEmpty}</ThemedText></Card>;

  return <>
    {days.map(day => <Card key={day.id}>
      <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{day.site_name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {copy.workedLabel} : {formatElapsed(
          (day.ended_at ? Date.parse(day.ended_at) : Date.parse(day.planned_end_at)) - Date.parse(day.started_at), copy)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{day.checks} {copy.checksToday}</ThemedText>
      {(day.seconds_inside > 0 || day.seconds_outside > 0)
        && <ZoneTime secondsInside={day.seconds_inside} secondsOutside={day.seconds_outside} />}
      <ThemedText type="smallBold">{copy.tasksDone}</ThemedText>
      {day.tasks.length
        ? day.tasks.map(task => <View key={task.task_code}
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <ThemedText type="small" style={{ flex: 1 }}>{task[label]}</ThemedText>
            <ThemedText type="smallBold">{task.quantity} {unitShort(task.unit, copy)}</ThemedText>
          </View>)
        : <ThemedText type="small" themeColor="textSecondary">{copy.noTasks}</ThemedText>}
    </Card>)}
  </>;
}
