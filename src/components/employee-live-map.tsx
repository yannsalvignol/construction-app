import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { BrandSpinner } from './brand-spinner';
import { Action, Card } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useMapDiagnostics } from '@/hooks/use-map-diagnostics';
import { useTheme } from '@/hooks/use-theme';
import { hasBackgroundLocation, pushCurrentPosition } from '@/lib/live-location';
import { supabase } from '@/lib/supabase';
import { positionAge, workCopy } from '@/lib/work-copy';

/**
 * Replaces the "nothing to check right now" card while live sharing is on. The
 * employee sees the same position their chef sees, which makes the sharing
 * visible instead of silent, and gives them a way to push a fresh fix by hand.
 */
export function EmployeeLiveMap() {
  const { locale } = useI18n();
  const diagnostics = useMapDiagnostics('employé');
  const copy = workCopy(locale);
  const theme = useTheme();
  const [shared, setShared] = useState<
    { latitude: number; longitude: number; accuracy_meters: number | null; recorded_at: string } | null
  >(null);
  const sharedAt = shared?.recorded_at ?? null;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [background, setBackground] = useState(true);
  // Until the tiles arrive the map is a blank rectangle, which reads as broken.
  const [mapReady, setMapReady] = useState(false);
  const lock = useRef(false);
  const map = useRef<MapView | null>(null);
  // Centre on a fix once. Re-centring on every read would yank the camera away
  // from wherever the employee has panned to.
  const framed = useRef('');

  const readShared = useCallback(async () => {
    // The read policy lets an employee see their own row and nobody else's.
    const { data } = await supabase
      .from('live_positions')
      .select('latitude, longitude, accuracy_meters, recorded_at')
      .maybeSingle();
    setShared(data ?? null);
    setNow(Date.now());
    if (data) {
      const key = `${data.latitude},${data.longitude}`;
      if (key !== framed.current) {
        framed.current = key;
        map.current?.animateToRegion(
          { latitude: data.latitude, longitude: data.longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 },
          600
        );
      }
    }
  }, []);

  const send = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    await pushCurrentPosition();
    setBackground(await hasBackgroundLocation());
    await readShared();
    lock.current = false; setBusy(false);
  }, [readShared]);

  useFocusEffect(useCallback(() => { void send(); }, [send]));

  return <Card>
    <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{copy.myPosition}</ThemedText>
    <View style={{ height: 260, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      {/* No followsUserLocation: it re-centres on every fix, which cancels the
          user's own panning — the map could be zoomed but never moved. The
          camera is pointed at the shared position instead, once per fix. */}
      <MapView
        // Google on both platforms, deliberately: see app.config.js.
        provider={PROVIDER_GOOGLE}
        onMapLoaded={diagnostics.onMapLoaded}
        ref={map}
        style={{ flex: 1 }}
        showsUserLocation
        initialRegion={
          shared
            ? {
                latitude: shared.latitude,
                longitude: shared.longitude,
                latitudeDelta: 0.004,
                longitudeDelta: 0.004,
              }
            : undefined
        }
        onMapReady={() => { diagnostics.onMapReady(); setMapReady(true); }}>
        {shared && (
          <>
            {/* The pin is the position the chef can see, which is the point of
                this map: not where the phone is now, but what was shared. */}
            <Marker
              coordinate={{ latitude: shared.latitude, longitude: shared.longitude }}
              title={copy.sharedWithChef}
              pinColor={theme.accent}
            />
            {shared.accuracy_meters != null && (
              <Circle
                center={{ latitude: shared.latitude, longitude: shared.longitude }}
                radius={shared.accuracy_meters}
                strokeColor={theme.accent}
                fillColor={theme.accentSoft}
              />
            )}
          </>
        )}
      </MapView>
      {!mapReady && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.backgroundInput,
          }}>
          <BrandSpinner size={40} />
        </View>
      )}
    </View>
    <ThemedText type="smallBold" themeColor="accentText">{copy.sharedWithChef}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">
      {sharedAt ? `${copy.lastShared} : ${positionAge(sharedAt, copy, now)}` : copy.notSharedYet}
    </ThemedText>
    {/* iOS never offers "Always" on the first prompt, so this is the normal state
        for a cooperative employee, not a refusal. */}
    {/* iOS never offers "Always" on the first prompt, so this is the normal state
        for a cooperative employee, not a refusal. */}
    {!background && <ThemedText type="small" themeColor="textSecondary">{copy.foregroundOnly}</ThemedText>}
    <Action secondary label={copy.refreshPosition} busy={busy} onPress={() => { void send(); }} />
  </Card>;
}
