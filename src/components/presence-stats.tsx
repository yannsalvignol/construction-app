import { View } from 'react-native';
import { Card } from './work-ui';
import { ThemedText } from './themed-text';
import { ZoneTime } from './zone-time';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { formatElapsed, workCopy } from '@/lib/work-copy';

/**
 * Today's presence at a glance, above the proof history. Reads the workspace
 * without driving the sharing lifecycle, which the day screen already owns.
 */
export function PresenceStats() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const { data, now, liveConsented } = useWorkspace({ manageSharing: false });
  if (!data) return null;

  const day = data.day;
  const active = !!day && !day.ended_at && Date.parse(day.planned_end_at) > now;
  const missed = data.requests.filter(r => Date.parse(r.expires_at) <= now
    && !data.checks.some(c => c.request_id === r.id)).length;
  const liveSharing = data.location_mode === 'live' && !!liveConsented;

  return <Card>
    <ThemedText style={{ fontSize: 24, fontWeight: '700' }}>{copy.liveStats}</ThemedText>
    {!day ? <ThemedText themeColor="textSecondary">{copy.noDayToday}</ThemedText> : <>
      <ThemedText themeColor="textSecondary">
        {active ? copy.elapsedLabel : copy.workedLabel} : {formatElapsed(
          (day.ended_at ? Date.parse(day.ended_at) : now) - Date.parse(day.started_at), copy)}
      </ThemedText>
      <View style={{ flexDirection: 'row', gap: 24 }}>
        <View>
          <ThemedText style={{ fontSize: 26, fontWeight: '700' }} themeColor="accentText">{data.checks.length}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{copy.checksToday}</ThemedText>
        </View>
        <View>
          <ThemedText style={{ fontSize: 26, fontWeight: '700', color: missed ? theme.danger : theme.text }}>{missed}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{copy.missedToday}</ThemedText>
        </View>
      </View>
      {liveSharing && <ZoneTime secondsInside={day.seconds_inside} secondsOutside={day.seconds_outside} />}
    </>}
  </Card>;
}
