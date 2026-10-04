import { LiveTeamMap } from '@/components/live-team-map';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

export default function LiveTeamScreen() {
  const { locale } = useI18n();

  // No heading of its own: the map is the screen, and the search field stands
  // where the title used to. The screen is reduced to the one thing it has to
  // say that the map cannot — the rule about who can be seen, folded behind
  // the chevron next to the search.
  return <LiveTeamMap hint={workCopy(locale).liveHint} />;
}
