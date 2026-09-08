import { PresenceHistory } from '@/components/screens/presence-history';
import { WorkPage } from '@/components/work-ui';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';
export default function ChecksScreen() {
  const { locale } = useI18n();
  return <WorkPage title={workCopy(locale).history}><PresenceHistory /></WorkPage>;
}
