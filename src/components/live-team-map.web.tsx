import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Action, Card, Feedback } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { fetchLiveTeam, type LivePosition } from '@/lib/live-location';
import { workCopy } from '@/lib/work-copy';

const REFRESH_MS = 30_000;

/** Morocco, as a bounding box: west, south, east, north. */
const MOROCCO = [-13.2, 27.6, -1.0, 35.9] as const;

// react-native-maps has no web build, so the browser gets an OpenStreetMap frame
// instead. It needs no API key, which keeps the web build free of map credentials.
function embedUrl(team: LivePosition[]) {
  if (!team.length) {
    return `https://www.openstreetmap.org/export/embed.html?bbox=${MOROCCO.join(',')}&layer=mapnik`;
  }
  const lats = team.map(m => m.latitude);
  const lngs = team.map(m => m.longitude);
  const pad = 0.02;
  const bbox = [
    Math.min(...lngs) - pad, Math.min(...lats) - pad,
    Math.max(...lngs) + pad, Math.max(...lats) + pad,
  ];
  const first = team[0];
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox.join(',')}&layer=mapnik&marker=${first.latitude},${first.longitude}`;
}

export function LiveTeamMap() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [team, setTeam] = useState<LivePosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const rows = await fetchLiveTeam();
      if (sequence !== request.current) return;
      setTeam(rows); setError(null);
    } catch { if (sequence === request.current) setError(copy.failed); }
  }, [copy.failed]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); request.current++; };
  }, [refresh]));

  return <View style={{ gap: 16 }}>
    <Feedback message={error} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    <View style={{ height: 380, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      <iframe
        title={copy.liveTitle}
        src={embedUrl(team ?? [])}
        style={{ border: 0, width: '100%', height: '100%' }}
      />
    </View>
    {!team && !error && <ThemedText>{copy.loading}</ThemedText>}
    {team && !team.length && <Card><ThemedText>{copy.noLive}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{copy.noLiveHint}</ThemedText></Card>}
    {team?.map(member => <Card key={member.employee_id}>
      <ThemedText type="smallBold">{member.employee_name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {member.site_name} · {member.latitude.toFixed(5)}, {member.longitude.toFixed(5)} · {copy.accuracy} ±{Math.round(member.accuracy_meters)} m
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {new Date(member.recorded_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
      </ThemedText>
    </Card>)}
  </View>;
}
