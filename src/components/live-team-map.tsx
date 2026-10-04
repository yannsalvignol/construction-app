import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView, { Circle, Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Card, Feedback, pageStyles } from './work-ui';
import { ThemedText } from './themed-text';
import { BrandSpinner } from './brand-spinner';
import { OnSiteBadge } from './on-site-badge';
import { SiteRow } from './site-row';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { MAP_PROVIDER } from '@/components/map-provider';
import { useMapDiagnostics } from '@/hooks/use-map-diagnostics';
import { useTheme } from '@/hooks/use-theme';
import { readCache, writeCache } from '@/hooks/use-cached';
import { fetchLiveTeam, type LivePosition } from '@/lib/live-location';
import { liveTeamKey, loadSites, sitesKey } from '@/lib/tab-data';
import type { Site } from '@/lib/presence';
import { positionAge, STALE_AFTER_MS, workCopy } from '@/lib/work-copy';

const REFRESH_MS = 30_000;

/** The map always opens on Morocco, so an empty team still shows the right country. */
const MOROCCO = { latitude: 31.7917, longitude: -7.0926, latitudeDelta: 12, longitudeDelta: 12 };
/** Deltas used when centring on one pin picked from the lists below the map. */
const CLOSE_UP = { latitudeDelta: 0.006, longitudeDelta: 0.006 };

/**
 * Has a map drawn at all this session?
 *
 * The spinner over the map earns its place the first time, when there is
 * nothing but a grey rectangle and no way to tell loading from broken. On
 * every visit after that the tiles are in the device's cache and come back in
 * a frame or two, and a spinner that appears and vanishes is itself the flash
 * it was meant to cover.
 */
let mapHasDrawn = false;

/** The region that holds every point, with a margin, so the map opens framed
 *  on the cached pins instead of on the whole country and then jumping. */
function regionFor(points: { latitude: number; longitude: number }[]) {
  if (!points.length) return MOROCCO;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.01),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.01),
  };
}

/** Which pins and list are shown; null shows both. */
type Tab = 'people' | 'sites' | null;

/** Owns the page scroll: `header` scrolls away, the map and filter stay pinned
 * at the top, and the employee / chantier lists scroll underneath. */
export function LiveTeamMap({ header }: { header: React.ReactNode }) {
  const { locale } = useI18n();
  const { profile } = useAuth();
  const diagnostics = useMapDiagnostics('équipe');
  const copy = workCopy(locale);
  const theme = useTheme();
  // Both seeded from the cache the tabs are warmed into, so the tab opens on
  // pins instead of on an empty map that fills in a moment later. A position
  // out of that cache is treated exactly like one that has sat on the server
  // all morning: drawn faded, with its age next to the name. The page says how
  // old every pin is, which is what makes showing an old one honest.
  const companyId = profile?.company_id ?? '';
  const [team, setTeam] = useState<LivePosition[] | null>(
    () => readCache<LivePosition[]>(liveTeamKey(companyId)) ?? null
  );
  const [sites, setSites] = useState<Site[]>(
    () => (readCache<Site[]>(sitesKey(companyId)) ?? []).filter((site) => site.latitude != null)
  );
  // Employés, not both: the question this tab is opened with is where the
  // crew is, and the chantiers are pins that do not move. The web map has
  // always opened this way; the native one was the odd one out. Tapping it
  // again still clears the filter and brings the chantiers back.
  const [tab, setTab] = useState<Tab>('people');
  const tabRef = useRef<Tab>('people');
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
  const sitesRef = useRef<Site[]>(sites);
  const teamRef = useRef<LivePosition[]>(team ?? []);
  // Tiles take a moment to arrive; until they do the map is a blank rectangle,
  // which reads as broken rather than loading.
  const [mapReady, setMapReady] = useState(mapHasDrawn);
  // Fixed at mount: a region that moved under the camera would fight the
  // framing and the chef's own panning.
  // The people, because that is the tab it opens on: framing on anything the
  // first frame() will not frame puts a jump in front of the chef.
  const [initialRegion] = useState(() => regionFor(
    (team ?? []).map((m) => ({ latitude: m.latitude, longitude: m.longitude }))
  ));

  // Frames only what the selected tab shows, so picking "Chantiers" zooms to the
  // sites and picking "Employés" to the people.
  const frame = useCallback((allRows: LivePosition[], allPins: Site[]) => {
    const rows = tabRef.current === 'sites' ? [] : allRows;
    const pins = tabRef.current === 'people' ? [] : allPins;
    const key = [tabRef.current, ...rows.map(r => r.employee_id), ...pins.map(p => p.id)].sort().join(',');
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

  /** Tapping the selected tab again deselects it: both kinds of pins come back. */
  function selectTab(next: Exclude<Tab, null>) {
    const value = tabRef.current === next ? null : next;
    tabRef.current = value;
    setTab(value);
    frame(teamRef.current, sitesRef.current);
  }

  /** Centring is a deliberate act, so it overrides framing until the pins change. */
  function centreOn(latitude: number, longitude: number) {
    map.current?.animateToRegion({ latitude, longitude, ...CLOSE_UP }, 500);
  }

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const rows = await fetchLiveTeam();
      if (sequence !== request.current) return;
      writeCache(liveTeamKey(companyId), rows);
      teamRef.current = rows; setTeam(rows); setError(null); frame(rows, sitesRef.current);
      // Runs after a network response, never during render; the lint cannot tell.
      // eslint-disable-next-line react-hooks/purity
      setNow(Date.now());
    } catch { if (sequence === request.current) setError(copy.failed); }
  }, [companyId, copy.failed, frame]);

  const refreshSites = useCallback(async () => {
    // The same query the Chantiers tab caches, so the two tabs warm each other
    // rather than each asking for the list on its own.
    const all = await loadSites(companyId);
    // Cached whole, because the Chantiers tab reads this same key and wants
    // every active site; only the map drops the ones with no coordinates.
    writeCache(sitesKey(companyId), all);
    const located = all.filter((site) => site.latitude != null);
    sitesRef.current = located;
    setSites(located);
    frame(teamRef.current, located);
  }, [companyId, frame]);

  useFocusEffect(useCallback(() => {
    void refresh(); void refreshSites();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); request.current++; };
  }, [refresh, refreshSites]));

  // Rebuilt on each render from the current team: membership changes as people
  // start and stop sharing, and a stale set would offer dead links.
  const locatable = new Set((team ?? []).map(member => member.employee_id));
  // A position kept for the whole day can be old; say how old rather than drop it.
  const isStale = (recordedAt: string) => now - Date.parse(recordedAt) > STALE_AFTER_MS;
  const showPeople = tab !== 'sites';
  const showSites = tab !== 'people';

  return <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
   <ScrollView contentContainerStyle={pageStyles.page} stickyHeaderIndices={[1]}>
    {header}
    {/* Pinned block: opaque so the lists disappear behind it as they scroll up. */}
    <View style={{ gap: 16, paddingBottom: 4, backgroundColor: theme.background }}>
    {/* The map is always mounted, empty team or not: an empty map on Morocco reads
        as "nobody is sharing", where no map at all just looks broken. */}
    <View style={{ height: 380, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      {/* Panning and zooming belong to the map; the page is scrolled from the lists
          below it, which is why the map is pinned rather than scrolling away. */}
      <MapView provider={MAP_PROVIDER}
        onMapLoaded={diagnostics.onMapLoaded}
        ref={map} style={{ flex: 1 }} initialRegion={initialRegion} rotateEnabled={false} pitchEnabled={false}
        onMapReady={() => { diagnostics.onMapReady(); mapHasDrawn = true; setMapReady(true); }}>
        {showSites && sites.map(site => site.latitude != null && site.longitude != null
          ? <Marker key={'site-' + site.id} coordinate={{ latitude: site.latitude, longitude: site.longitude }}
              title={site.name} description={site.address ?? undefined} pinColor={theme.accent} />
          : null)}
        {showPeople && team?.map(member => <Marker key={member.employee_id}
          coordinate={{ latitude: member.latitude, longitude: member.longitude }}
          opacity={isStale(member.recorded_at) ? 0.5 : 1}
          pinColor={member.on_site === false ? theme.danger : theme.success}
          title={member.employee_name}
          description={`${member.site_name} · ${positionAge(member.recorded_at, copy, now)}`} />)}
        {/* The reported accuracy is drawn, so a coarse fix is never read as an exact spot. */}
        {showPeople && team?.map(member => <Circle key={member.employee_id + '-accuracy'}
          center={{ latitude: member.latitude, longitude: member.longitude }}
          radius={member.accuracy_meters} strokeColor={theme.accent} fillColor={theme.accentSoft} />)}
      </MapView>
      {!mapReady && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.backgroundInput,
          }}>
          <BrandSpinner size={44} />
        </View>
      )}
    </View>
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
      {([['people', copy.employees], ['sites', copy.siteLegend]] as const).map(([key, label]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
          onPress={() => selectTab(key)} style={({ pressed }) => ({
            flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1,
            backgroundColor: tab === key ? theme.backgroundElement : theme.background,
            borderColor: tab === key ? 'transparent' : theme.text,
            opacity: pressed ? 0.7 : 1,
          })}>
          <ThemedText type="smallBold" themeColor={tab === key ? 'text' : 'textSecondary'}>{label}</ThemedText>
        </Pressable>)}
    </View>
    </View>

    <Feedback message={error} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}

    {showPeople && <>
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
    </>}
    {showSites && <>
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
   </ScrollView>
  </SafeAreaView>;
}
