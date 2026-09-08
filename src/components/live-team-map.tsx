import { useCallback, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView, { Circle, Marker } from 'react-native-maps';
import { Action, Card, Feedback } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { fetchLiveTeam, type LivePosition } from '@/lib/live-location';
import { workCopy } from '@/lib/work-copy';

const REFRESH_MS = 30_000;

/** The map always opens on Morocco, so an empty team still shows the right country. */
const MOROCCO = { latitude: 31.7917, longitude: -7.0926, latitudeDelta: 12, longitudeDelta: 12 };

export function LiveTeamMap() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [team, setTeam] = useState<LivePosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const map = useRef<MapView | null>(null);
  // Recentre only when the set of shared positions actually changes, so a routine
  // refresh never yanks the camera away from wherever the chef has panned.
  const framed = useRef('');

  const frame = useCallback((rows: LivePosition[]) => {
    const key = rows.map(r => r.employee_id).sort().join(',');
    if (key === framed.current) return;
    framed.current = key;
    if (!rows.length) { map.current?.animateToRegion(MOROCCO, 400); return; }
    map.current?.fitToCoordinates(
      rows.map(r => ({ latitude: r.latitude, longitude: r.longitude })),
      { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true },
    );
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const rows = await fetchLiveTeam();
      if (sequence !== request.current) return;
      setTeam(rows); setError(null); frame(rows);
    } catch { if (sequence === request.current) setError(copy.failed); }
  }, [copy.failed, frame]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); request.current++; };
  }, [refresh]));

  return <View style={{ gap: 16 }}>
    <Feedback message={error} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    {/* The map is always mounted, empty team or not: an empty map on Morocco reads
        as "nobody is sharing", where no map at all just looks broken. */}
    <View style={{ height: 380, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      <MapView ref={map} style={{ flex: 1 }} initialRegion={MOROCCO}>
        {team?.map(member => <Marker key={member.employee_id}
          coordinate={{ latitude: member.latitude, longitude: member.longitude }}
          title={member.employee_name} description={member.site_name} />)}
        {/* The reported accuracy is drawn, so a coarse fix is never read as an exact spot. */}
        {team?.map(member => <Circle key={member.employee_id + '-accuracy'}
          center={{ latitude: member.latitude, longitude: member.longitude }}
          radius={member.accuracy_meters} strokeColor={theme.accent} fillColor={theme.accentSoft} />)}
      </MapView>
    </View>
    {!team && !error && <ThemedText>{copy.loading}</ThemedText>}
    {team && !team.length && <Card><ThemedText>{copy.noLive}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{copy.noLiveHint}</ThemedText></Card>}
    {team?.map(member => <Card key={member.employee_id}>
      <ThemedText type="smallBold">{member.employee_name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {member.site_name} · {copy.accuracy} ±{Math.round(member.accuracy_meters)} m · {new Date(member.recorded_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
      </ThemedText>
    </Card>)}
  </View>;
}
