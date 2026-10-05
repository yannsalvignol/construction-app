import { useState } from 'react';

import { QuoteTasks } from '@/components/quote-tasks';
import { Disclosure } from '@/components/disclosure';
import { ExtraTasks } from '@/components/extra-tasks';
import { TaskForm } from '@/components/task-form';
import { Action, Feedback, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { useWorkspace } from '@/hooks/use-workspace';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

export default function TasksScreen() {
  const { t, locale } = useI18n();
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

      {/* Two exceptions to the devis, each a heading that opens into itself:
          the catalogue, for work the company does often enough to have named,
          and a blank box for the week a chantier invents something new. */}
      <Disclosure
        icon="list-outline"
        title={t.quoteTasks.otherWork}
        hint={t.quoteTasks.otherWorkHint}
        open={otherOpen}
        onToggle={() => setOtherOpen((current) => !current)}>
        <TaskForm data={data} onSaved={refresh} />
      </Disclosure>

      <Disclosure
        icon="create-outline"
        title={copy.extraTitle}
        hint={copy.extraHint}
        open={extraOpen}
        onToggle={() => setExtraOpen((current) => !current)}>
        {data.day && <ExtraTasks dayId={data.day.id} onSaved={refresh} />}
      </Disclosure>
    </> : <ThemedText themeColor="textSecondary">{copy.startForTasks}</ThemedText>)}
  </WorkPage>;
}
