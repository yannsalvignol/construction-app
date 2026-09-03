import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_DEFAULT, PROVIDER_GOOGLE, type MapType } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ACCENT,
  ControlButton,
  LiveDot,
  MOROCCO_REGION,
  MUTED,
  type MappedPerson,
  PersonMarker,
  SURFACE,
  cardShadow,
  closeUpRegion,
  coordinateOf,
  initials,
  isStale,
  lastSeenLabel,
  mapStyles,
  useMinuteClock,
} from '@/components/map/map-kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useLocationSharingStatus } from '@/hooks/use-location-sharing';
import { useTheme } from '@/hooks/use-theme';
import type { Translations } from '@/lib/i18n/en';
import { supabase } from '@/lib/supabase';

/** Backstop poll, in case the realtime socket is asleep or blocked on the network. */
const REFRESH_INTERVAL_MS = 30000;

/**
 * The employee's own view: their position and nobody else's. The query is
 * pinned to their own id, and RLS (profiles_select_own) means a teammate's row
 * is not readable from this client even if the filter were wrong.
 */
export function MyLocationMap() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const sharingStatus = useLocationSharingStatus();
  const now = useMinuteClock();

  const mapRef = useRef<MapView>(null);
  const [me, setMe] = useState<MappedPerson | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState<MapType>('standard');

  const trackingEnabled = profile?.location_tracking_enabled ?? false;

  // Read back what the server actually stored, so this screen shows exactly the
  // position the chef sees rather than an optimistic local one.
  const fetchMyLocation = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, last_latitude, last_longitude, location_updated_at')
      .eq('id', profile.id)
      .maybeSingle();

    if (error) {
      console.error('[my-location-map] failed to load own location', error);
      return;
    }
    setMe(
      data && data.last_latitude !== null && data.last_longitude !== null
        ? (data as MappedPerson)
        : null
    );
  }, [profile]);

  useEffect(() => {
    fetchMyLocation();
    const interval = setInterval(fetchMyLocation, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMyLocation]);

  useFocusEffect(
    useCallback(() => {
      fetchMyLocation();
    }, [fetchMyLocation])
  );

  const recenter = useCallback(() => {
    mapRef.current?.animateToRegion(me ? closeUpRegion(coordinateOf(me)) : MOROCCO_REGION, 600);
  }, [me]);

  // Zoom in the first time a position exists, then leave the camera alone so the
  // map doesn't jump every time a new fix lands.
  const hasFramed = useRef(false);

  useEffect(() => {
    if (!mapReady || hasFramed.current || !me) return;
    hasFramed.current = true;
    mapRef.current?.animateToRegion(closeUpRegion(coordinateOf(me)), 900);
  }, [mapReady, me]);

  useEffect(() => {
    if (!trackingEnabled) hasFramed.current = false;
  }, [trackingEnabled]);

  const live = !!me && !isStale(me, now);
  const state = describeState(t, { trackingEnabled, sharingStatus, hasPosition: !!me, live });

  return (
    <View style={[mapStyles.screen, { paddingBottom: insets.bottom + Spacing.three }]}>
      <View style={[mapStyles.mapCard, cardShadow, { borderColor: theme.backgroundSelected }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
          initialRegion={MOROCCO_REGION}
          mapType={mapType}
          onMapReady={() => setMapReady(true)}
          showsCompass={false}
          toolbarEnabled={false}>
          {me && <PersonMarker person={me} now={now} label={t.map.you} selected />}
        </MapView>

        <View style={[mapStyles.statusPill, cardShadow, { borderColor: theme.backgroundSelected }]}>
          <LiveDot color={live ? ACCENT : MUTED} live={live} />
          <ThemedText type="smallBold">{state.pill}</ThemedText>
        </View>

        <View style={mapStyles.controls}>
          <ControlButton
            icon={{ ios: 'map', android: 'layers', web: 'layers' }}
            label={mapType === 'standard' ? t.map.switchToSatellite : t.map.switchToStandard}
            active={mapType !== 'standard'}
            onPress={() => setMapType((type) => (type === 'standard' ? 'hybrid' : 'standard'))}
          />
          <ControlButton
            icon={{ ios: 'scope', android: 'center_focus_strong', web: 'center_focus_strong' }}
            label={me ? t.map.centerOnMe : t.map.showMorocco}
            onPress={recenter}
          />
        </View>

        <View style={[mapStyles.bottomCard, cardShadow, { borderColor: theme.backgroundSelected }]}>
          {me && profile ? (
            <View style={[mapStyles.avatar, { backgroundColor: live ? ACCENT : MUTED }]}>
              <ThemedText type="smallBold" style={styles.avatarText}>
                {initials(profile)}
              </ThemedText>
            </View>
          ) : (
            <SymbolView name={state.icon} size={22} tintColor={theme.textSecondary} />
          )}
          <View style={mapStyles.bottomCardBody}>
            <ThemedText type="smallBold">{state.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {me ? `${state.body} · ${lastSeenLabel(t, locale, me.location_updated_at, now)}` : state.body}
            </ThemedText>
          </View>
        </View>
      </View>
    </View>
  );
}

function describeState(
  t: Translations,
  {
    trackingEnabled,
    sharingStatus,
    hasPosition,
    live,
  }: {
    trackingEnabled: boolean;
    sharingStatus: ReturnType<typeof useLocationSharingStatus>;
    hasPosition: boolean;
    live: boolean;
  }
) {
  const off = { ios: 'location.slash', android: 'location_off', web: 'location_off' } as const;
  const waiting = { ios: 'location', android: 'my_location', web: 'my_location' } as const;

  if (!trackingEnabled) {
    return { ...t.map.myLocation.sharingOff, icon: off };
  }

  if (sharingStatus === 'denied') {
    return { ...t.map.myLocation.permissionDenied, icon: off };
  }

  if (sharingStatus === 'error') {
    return { ...t.map.myLocation.sendError, icon: off };
  }

  if (!hasPosition) {
    return { ...t.map.myLocation.locating, icon: waiting };
  }

  return { ...(live ? t.map.myLocation.live : t.map.myLocation.paused), icon: waiting };
}

const styles = StyleSheet.create({
  avatarText: {
    color: SURFACE,
    fontSize: 13,
    lineHeight: 16,
  },
});
