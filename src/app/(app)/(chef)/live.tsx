import { LiveTeamMap } from '@/components/live-team-map';
import { WorkPage } from '@/components/work-ui';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

export default function LiveTeamScreen() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  return <WorkPage title={copy.liveTitle} subtitle={copy.liveHint}><LiveTeamMap /></WorkPage>;
}
