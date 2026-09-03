import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
  regionForCoordinates,
  useMinuteClock,
} from '@/components/map/map-kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';


/** Backstop poll, in case the realtime socket is asleep or blocked on the network. */
const REFRESH_INTERVAL_MS = 30000;

const CARD_WIDTH = 232;
const CARD_GAP = Spacing.two;
const CARD_STRIDE = CARD_WIDTH + CARD_GAP;

function EmployeeCard({
  employee,
  now,
  selected,
  onPress,
}: {
  employee: MappedPerson;
  now: number;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const stale = isStale(employee, now);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        cardShadow,
        {
          borderColor: selected ? ACCENT : theme.backgroundSelected,
          borderWidth: selected ? 2 : 1,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <View style={[mapStyles.avatar, { backgroundColor: stale ? MUTED : ACCENT }]}>
        <ThemedText type="smallBold" style={styles.avatarText}>
          {initials(employee)}
        </ThemedText>
      </View>
      <View style={mapStyles.bottomCardBody}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {employee.first_name} {employee.last_name}
        </ThemedText>
        <View style={mapStyles.metaRow}>
          <View style={[styles.dot, { backgroundColor: stale ? MUTED : ACCENT }]} />
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {stale ? t.map.lastSeen : t.map.liveLabel} ·{' '}
            {lastSeenLabel(t, locale, employee.location_updated_at, now)}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

/** The chef's view: every employee in the company who is currently sharing a position. */
export function TeamMap() {
  const theme = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const now = useMinuteClock();

  const mapRef = useRef<MapView>(null);
  const carouselRef = useRef<ScrollView>(null);
  const [employees, setEmployees] = useState<MappedPerson[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapType, setMapType] = useState<MapType>('standard');

  const fetchLocations = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, last_latitude, last_longitude, location_updated_at')
      .eq('company_id', profile.company_id)
      .eq('role', 'employee')
      .not('last_latitude', 'is', null)
      .not('last_longitude', 'is', null)
      .order('first_name');

    if (error) {
      console.error('[team-map] failed to load employee locations', error);
      return;
    }
    setEmployees(data ?? []);
  }, [profile]);

  // Realtime is the fast path; the interval and the focus refetch below are there
  // so a dropped socket can't leave the chef staring at an empty map.
  useEffect(() => {
    fetchLocations();

    if (!profile) return;

    const channel = supabase
      .channel(`team-locations-${profile.company_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `company_id=eq.${profile.company_id}`,
        },
        () => fetchLocations()
      )
      .subscribe();

    const interval = setInterval(fetchLocations, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [profile, fetchLocations]);

  useFocusEffect(
    useCallback(() => {
      fetchLocations();
    }, [fetchLocations])
  );

  const coordinates = useMemo(() => employees.map(coordinateOf), [employees]);

  const selectEmployee = useCallback((employee: MappedPerson, index: number) => {
    setSelectedId(employee.id);
    mapRef.current?.animateToRegion(closeUpRegion(coordinateOf(employee)), 500);
    carouselRef.current?.scrollTo({ x: index * CARD_STRIDE, animated: true });
  }, []);

  const recenter = useCallback(() => {
    setSelectedId(null);
    const region = coordinates.length ? regionForCoordinates(coordinates) : MOROCCO_REGION;
    mapRef.current?.animateToRegion(region, 600);
  }, [coordinates]);

  // Re-frame the map when the *set* of employees sharing changes — someone comes
  // online or drops off. Deliberately not on every coordinate update, so the chef
  // can pan around without the map yanking itself back every 30 seconds.
  const teamKey = employees
    .map((employee) => employee.id)
    .sort()
    .join(',');
  const lastFittedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!mapReady || lastFittedKey.current === teamKey) return;
    lastFittedKey.current = teamKey;
    if (!coordinates.length) return;
    mapRef.current?.animateToRegion(regionForCoordinates(coordinates), 900);
    // `coordinates` changes on every position update; the team key is what should
    // drive a re-frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, teamKey]);

  const liveCount = employees.filter((employee) => !isStale(employee, now)).length;

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
          onPress={() => setSelectedId(null)}
          showsCompass={false}
          toolbarEnabled={false}>
          {employees.map((employee, index) => (
            <PersonMarker
              key={employee.id}
              person={employee}
              now={now}
              selected={employee.id === selectedId}
              onPress={() => selectEmployee(employee, index)}
            />
          ))}
        </MapView>

        <View style={[mapStyles.statusPill, cardShadow, { borderColor: theme.backgroundSelected }]}>
          <LiveDot color={liveCount ? ACCENT : MUTED} live={liveCount > 0} />
          <ThemedText type="smallBold">
            {employees.length ? t.map.live(liveCount) : t.map.nobodySharing}
          </ThemedText>
          {employees.length > liveCount && (
            <ThemedText type="small" themeColor="textSecondary">
              {t.map.idle(employees.length - liveCount)}
            </ThemedText>
          )}
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
            label={employees.length ? t.map.showWholeTeam : t.map.showMorocco}
            onPress={recenter}
          />
        </View>

        {employees.length ? (
          <ScrollView
            ref={carouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_STRIDE}
            decelerationRate="fast"
            style={styles.carousel}
            contentContainerStyle={styles.carouselContent}>
            {employees.map((employee, index) => (
              <EmployeeCard
                key={employee.id}
                employee={employee}
                now={now}
                selected={employee.id === selectedId}
                onPress={() => selectEmployee(employee, index)}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={[mapStyles.bottomCard, cardShadow, { borderColor: theme.backgroundSelected }]}>
            <SymbolView
              name={{ ios: 'location.slash', android: 'location_off', web: 'location_off' }}
              size={22}
              tintColor={theme.textSecondary}
            />
            <View style={mapStyles.bottomCardBody}>
              <ThemedText type="smallBold">{t.map.noLiveLocations}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t.map.turnOnSharingNote}
              </ThemedText>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarText: {
    color: SURFACE,
    fontSize: 13,
    lineHeight: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  carousel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.three,
  },
  carouselContent: {
    paddingHorizontal: Spacing.three,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.four,
    backgroundColor: SURFACE,
  },
});
