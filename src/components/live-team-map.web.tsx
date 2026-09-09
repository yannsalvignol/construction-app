import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
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

/** Morocco, as a bounding box: west, south, east, north. */
const MOROCCO = [-13.2, 27.6, -1.0, 35.9] as const;

// react-native-maps has no web build, so the browser gets an OpenStreetMap frame
// instead. It needs no API key, which keeps the web build free of map credentials.
type Tab = 'people' | 'sites';

/** Half-width of the box drawn around a single pin the chef picked, in degrees. */
const CLOSE_UP = 0.003;

function embedUrl(team: LivePosition[], sites: Site[], focus: { latitude: number; longitude: number } | null) {
  if (focus) {
    const box = [focus.longitude - CLOSE_UP, focus.latitude - CLOSE_UP,
      focus.longitude + CLOSE_UP, focus.latitude + CLOSE_UP];
    return `https://www.openstreetmap.org/export/embed.html?bbox=${box.join(',')}&layer=mapnik&marker=${focus.latitude},${focus.longitude}`;
  }
  const points = [
    ...team.map(m => ({ latitude: m.latitude, longitude: m.longitude })),
    ...sites.flatMap(s => s.latitude != null && s.longitude != null
      ? [{ latitude: s.latitude, longitude: s.longitude }] : []),
  ];
  if (!points.length) {
    return `https://www.openstreetmap.org/export/embed.html?bbox=${MOROCCO.join(',')}&layer=mapnik`;
  }
  const lats = points.map(p => p.latitude);
  const lngs = points.map(p => p.longitude);
  const pad = 0.02;
  const bbox = [
    Math.min(...lngs) - pad, Math.min(...lats) - pad,
    Math.max(...lngs) + pad, Math.max(...lats) + pad,
  ];
  const first = points[0];
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox.join(',')}&layer=mapnik&marker=${first.latitude},${first.longitude}`;
}

export function LiveTeamMap() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [team, setTeam] = useState<LivePosition[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [tab, setTab] = useState<Tab>('people');
  const [focus, setFocus] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ticked with each refresh: reading the clock during render is not pure.
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const rows = await fetchLiveTeam();
      if (sequence !== request.current) return;
      setTeam(rows); setError(null); setNow(Date.now());
    } catch { if (sequence === request.current) setError(copy.failed); }
  }, [copy.failed]);

  const loadSites = useCallback(async () => {
    const { data } = await supabase.from('sites')
      .select('id,name,address,is_active,latitude,longitude')
      .eq('is_active', true).not('latitude', 'is', null);
    setSites(data ?? []);
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh(); void loadSites();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); request.current++; };
  }, [refresh, loadSites]));

  const locatable = new Set((team ?? []).map(member => member.employee_id));
  // A position kept for the whole day can be old; say how old rather than drop it.
  const isStale = (recordedAt: string) => now - Date.parse(recordedAt) > STALE_AFTER_MS;

  return <View style={{ gap: 16 }}>
    <Feedback message={error} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    <View style={{ height: 380, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      <iframe
        title={copy.liveTitle}
        src={embedUrl(team ?? [], sites, focus)}
        style={{ border: 0, width: '100%', height: '100%' }}
      />
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
        onPress={() => setFocus({ latitude: member.latitude, longitude: member.longitude })}
        style={({ pressed }) => pressed && { opacity: 0.6 }}>
        <Card>
          <ThemedText type="smallBold">{member.employee_name}</ThemedText>
          <OnSiteBadge onSite={member.on_site} distance={member.distance_meters} />
          <ThemedText type="small" themeColor={isStale(member.recorded_at) ? 'warning' : 'textSecondary'}>
            {member.site_name} · {positionAge(member.recorded_at, copy, now)}
          </ThemedText>
        </Card>
      </Pressable>)}
    </> : <>
      {!sites.length && <Card><ThemedText>{copy.noSitesLocated}</ThemedText></Card>}
      {sites.map(site => <SiteRow key={site.id} site={site}
        onPressSite={() => { if (site.latitude != null && site.longitude != null) setFocus({ latitude: site.latitude, longitude: site.longitude }); }}
        locatable={locatable}
        onLocate={employeeId => {
          const member = (team ?? []).find(m => m.employee_id === employeeId);
          if (member) setFocus({ latitude: member.latitude, longitude: member.longitude });
        }} />)}
    </>}
  </View>;
}
