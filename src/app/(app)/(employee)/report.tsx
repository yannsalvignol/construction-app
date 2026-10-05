import { QuoteTasks } from '@/components/quote-tasks';
import { OtherWork } from '@/components/other-work';
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
  return <WorkPage topInset title={copy.taskTitle}>
    {loading && <ThemedText>{copy.loading}</ThemedText>}
    <Feedback message={error} />
    {error && <Action label={copy.retry} onPress={() => { void refresh(); }} />}
    {data && (active ? <>
      {/* The chantier's devis is the task list: the work that was actually
          sold, in the words the chef quoted. The catalogue is not another list
          of the same standing — it is for the job nobody quoted, so it waits
          behind a heading instead of competing with the real one. */}
      {data.day && <QuoteTasks dayId={data.day.id} onSaved={refresh} />}

      {/* Everything the devis does not cover, in one card: he is answering
          "what else did you do", and whether the answer has a code is a
          detail of ours rather than of his day. */}
      {data.day && <OtherWork data={data} dayId={data.day.id} onSaved={refresh} />}
    </> : <ThemedText themeColor="textSecondary">{copy.startForTasks}</ThemedText>)}
  </WorkPage>;
}
