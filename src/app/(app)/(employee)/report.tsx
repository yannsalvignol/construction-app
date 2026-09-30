import { QuoteTasks } from '@/components/quote-tasks';
import { TaskForm } from '@/components/task-form';
import { Action, Feedback, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { useWorkspace } from '@/hooks/use-workspace';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

export default function TasksScreen() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const { data, loading, error, refresh, now } = useWorkspace();
  const active = data?.day && !data.day.ended_at && Date.parse(data.day.planned_end_at) > now;
  return <WorkPage title={copy.taskTitle}>
    {loading && <ThemedText>{copy.loading}</ThemedText>}
    <Feedback message={error} />
    {error && <Action label={copy.retry} onPress={() => { void refresh(); }} />}
    {data && (active ? <>
      {/* The chantier's devis first: it is the work that was actually sold,
          in the words the chef quoted. The catalogue below stays for anything
          the devis does not cover. */}
      {data.day && <QuoteTasks dayId={data.day.id} onSaved={refresh} />}
      <TaskForm data={data} onSaved={refresh} />
    </> : <ThemedText themeColor="textSecondary">{copy.startForTasks}</ThemedText>)}
  </WorkPage>;
}
