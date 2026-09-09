import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView, { Circle, Marker } from 'react-native-maps';
import { Action, Card, Feedback } from './work-ui';
import { ThemedText } from './themed-text';
import { OnSiteBadge } from './on-site-badge';
import { SiteRow } from './site-row';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { fetchLiveTeam, type LivePosition } from '@/lib/live-location';
import { supabase } from '@/lib/supabase';
import type { Site } from '@/lib/presence';
import { positionAge, STALE_AFTER_MS, workCopy } from '@/lib/work-copy';

const REFRESH_MS = 30_000;

/** The map always opens on Morocco, so an empty team still shows the right country. */
const MOROCCO = { latitude: 31.7917, longitude: -7.0926, latitudeDelta: 12, longitudeDelta: 12 };
/** Deltas used when centring on one pin picked from the lists below the map. */
const CLOSE_UP = { latitudeDelta: 0.006, longitudeDelta: 0.006 };

type Tab = 'people' | 'sites';

export function LiveTeamMap() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [team, setTeam] = useState<LivePosition[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [tab, setTab] = useState<Tab>('people');
  const [error, setError] = useState<string | null>(null);
  // Ticked with each refresh: reading the clock during render is not pure.
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const map = useRef<MapView | null>(null);
  // Recentre only when the set of shared positions actually changes, so a routine
  // refresh never yanks the camera away from wherever the chef has panned.
  const framed = useRef('');
  // Team and sites arrive from two independent requests; framing reads the latest
  // of both through refs so whichever finishes second still frames the full picture.
  const sitesRef = useRef<Site[]>([]);
  const teamRef = useRef<LivePosition[]>([]);

  const frame = useCallback((rows: LivePosition[], pins: Site[]) => {
    const key = [...rows.map(r => r.employee_id), ...pins.map(p => p.id)].sort().join(',');
    if (key === framed.current) return;
    framed.current = key;
    const points = [
      ...rows.map(r => ({ latitude: r.latitude, longitude: r.longitude })),
      ...pins.flatMap(p => p.latitude != null && p.longitude != null
        ? [{ latitude: p.latitude, longitude: p.longitude }] : []),
    ];
    if (!points.length) { map.current?.animateToRegion(MOROCCO, 400); return; }
    map.current?.fitToCoordinates(points,
      { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true });
  }, []);

  /** Centring is a deliberate act, so it overrides framing until the pins change. */
  function centreOn(latitude: number, longitude: number) {
    map.current?.animateToRegion({ latitude, longitude, ...CLOSE_UP }, 500);
  }

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const rows = await fetchLiveTeam();
      if (sequence !== request.current) return;
      teamRef.current = rows; setTeam(rows); setError(null); setNow(Date.now()); frame(rows, sitesRef.current);
    } catch { if (sequence === request.current) setError(copy.failed); }
  }, [copy.failed, frame]);

  const loadSites = useCallback(async () => {
    const { data } = await supabase.from('sites')
      .select('id,name,address,is_active,latitude,longitude')
      .eq('is_active', true).not('latitude', 'is', null);
    sitesRef.current = data ?? [];
    setSites(sitesRef.current);
    frame(teamRef.current, sitesRef.current);
  }, [frame]);

  useFocusEffect(useCallback(() => {
    void refresh(); void loadSites();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); request.current++; };
  }, [refresh, loadSites]));

  // Rebuilt on each render from the current team: membership changes as people
  // start and stop sharing, and a stale set would offer dead links.
  const locatable = new Set((team ?? []).map(member => member.employee_id));
  // A position kept for the whole day can be old; say how old rather than drop it.
  const isStale = (recordedAt: string) => now - Date.parse(recordedAt) > STALE_AFTER_MS;

  return <View style={{ gap: 16 }}>
    <Feedback message={error} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    {/* The map is always mounted, empty team or not: an empty map on Morocco reads
        as "nobody is sharing", where no map at all just looks broken. */}
    <View style={{ height: 380, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      <MapView ref={map} style={{ flex: 1 }} initialRegion={MOROCCO}>
        {sites.map(site => site.latitude != null && site.longitude != null
          ? <Marker key={'site-' + site.id} coordinate={{ latitude: site.latitude, longitude: site.longitude }}
              title={site.name} description={site.address ?? undefined} pinColor={theme.accent} />
          : null)}
        {team?.map(member => <Marker key={member.employee_id}
          coordinate={{ latitude: member.latitude, longitude: member.longitude }}
          opacity={isStale(member.recorded_at) ? 0.5 : 1}
          pinColor={member.on_site === false ? theme.danger : theme.success}
          title={member.employee_name}
          description={`${member.site_name} · ${positionAge(member.recorded_at, copy, now)}`} />)}
        {/* The reported accuracy is drawn, so a coarse fix is never read as an exact spot. */}
        {team?.map(member => <Circle key={member.employee_id + '-accuracy'}
          center={{ latitude: member.latitude, longitude: member.longitude }}
          radius={member.accuracy_meters} strokeColor={theme.accent} fillColor={theme.accentSoft} />)}
      </MapView>
    </View>
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {([['people', copy.employees], ['sites', copy.siteLegend]] as const).map(([key, label]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
          onPress={() => setTab(key)} style={({ pressed }) => ({
            flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1,
            backgroundColor: tab === key ? theme.accentSoft : theme.backgroundElement,
            borderColor: tab === key ? theme.accent : theme.backgroundSelected,
            opacity: pressed ? 0.7 : 1,
          })}>
          <ThemedText type="smallBold" themeColor={tab === key ? 'accentText' : 'textSecondary'}>{label}</ThemedText>
        </Pressable>)}
    </View>

    {tab === 'people' ? <>
      {!team && !error && <ThemedText>{copy.loading}</ThemedText>}
      {team && !team.length && <Card><ThemedText>{copy.noLive}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{copy.noLiveHint}</ThemedText></Card>}
      {team?.map(member => <Pressable key={member.employee_id} accessibilityRole="button"
        accessibilityLabel={member.employee_name}
        onPress={() => centreOn(member.latitude, member.longitude)}
        style={({ pressed }) => pressed && { opacity: 0.6 }}>
        <Card>
          <ThemedText type="smallBold">{member.employee_name}</ThemedText>
          <OnSiteBadge onSite={member.on_site} distance={member.distance_meters} />
          {/* GPS accuracy and the staleness sentence moved out: the age carries the
              same warning, in one line, and the accuracy circle is drawn on the map. */}
          <ThemedText type="small" themeColor="textSecondary">
            {member.site_name} ·{' '}
            <ThemedText type="small" themeColor={isStale(member.recorded_at) ? 'warning' : 'textSecondary'}>
              {positionAge(member.recorded_at, copy, now)}
            </ThemedText>
          </ThemedText>
        </Card>
      </Pressable>)}
    </> : <>
      {!sites.length && <Card><ThemedText>{copy.noSitesLocated}</ThemedText></Card>}
      {/* The same expanding row as the Sites tab, plus map behaviour: opening a site
          also centres on it, and a member who is sharing can be pointed at. */}
      {sites.map(site => <SiteRow key={site.id} site={site}
        onPressSite={() => { if (site.latitude != null && site.longitude != null) centreOn(site.latitude, site.longitude); }}
        locatable={locatable}
        onLocate={employeeId => {
          const member = teamRef.current.find(m => m.employee_id === employeeId);
          if (member) centreOn(member.latitude, member.longitude);
        }} />)}
    </>}
  </View>;
}
