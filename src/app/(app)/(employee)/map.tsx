import { PresenceHistory } from '@/components/screens/presence-history';
import { PresenceStats } from '@/components/presence-stats';
import { WorkPage } from '@/components/work-ui';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';
export default function ChecksScreen() {
  const { locale } = useI18n();
  return <WorkPage title={workCopy(locale).history}><PresenceStats /><PresenceHistory /></WorkPage>;
}
