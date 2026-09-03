import { SymbolView, SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Marker, type LatLng, type Region } from 'react-native-maps';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Translations } from '@/lib/i18n/en';
import type { Locale } from '@/lib/i18n/locale';

const DATE_LOCALE_TAG: Record<Locale, string> = { fr: 'fr-FR', en: 'en-US' };

/**
 * Whole-country view of Morocco. Every map in the app opens here before it knows
 * about any real position, and recentering falls back to it when there is none.
 */
export const MOROCCO_REGION: Region = {
  latitude: 31.7917,
  longitude: -7.0926,
  latitudeDelta: 11,
  longitudeDelta: 11,
};

/** Roughly a 2km box, so a single person lands at street level instead of on a rooftop. */
export const MIN_DELTA = 0.02;
/** Fraction of extra space kept around the outermost markers when fitting a group. */
export const FIT_PADDING = 1.6;
/** A position older than this is drawn muted — the person may have stopped sharing. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export const ACCENT = '#2c5aa0';
export const MUTED = '#8A8F98';
export const SURFACE = '#FFFFFF';
export const CARD_RADIUS = 28;

export const cardShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.14,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 5,
} as const;

export type MappedPerson = {
  id: string;
  first_name: string;
  last_name: string;
  last_latitude: number;
  last_longitude: number;
  location_updated_at: string;
};

/** Smallest region that shows every coordinate, with breathing room around the edges. */
export function regionForCoordinates(coordinates: LatLng[]): Region {
  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);

  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * FIT_PADDING, MIN_DELTA),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * FIT_PADDING, MIN_DELTA),
  };
}

export function coordinateOf(person: MappedPerson): LatLng {
  return { latitude: person.last_latitude, longitude: person.last_longitude };
}

export function closeUpRegion(coordinate: LatLng): Region {
  return { ...coordinate, latitudeDelta: MIN_DELTA, longitudeDelta: MIN_DELTA };
}

export function initials(person: Pick<MappedPerson, 'first_name' | 'last_name'>) {
  return `${person.first_name?.[0] ?? ''}${person.last_name?.[0] ?? ''}`.toUpperCase() || '?';
}

export function isStale(person: Pick<MappedPerson, 'location_updated_at'>, now: number) {
  return now - new Date(person.location_updated_at).getTime() > STALE_AFTER_MS;
}

export function lastSeenLabel(t: Translations, locale: Locale, updatedAt: string, now: number) {
  const minutes = Math.floor((now - new Date(updatedAt).getTime()) / 60000);
  if (minutes < 1) return t.map.justNow;
  if (minutes < 60) return t.map.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.map.hoursAgo(hours);
  return new Date(updatedAt).toLocaleDateString(DATE_LOCALE_TAG[locale]);
}

/** Ticks once a minute so relative times and stale colours age without a data refresh. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  return now;
}

/** Expanding halo behind a status dot, so "live" reads at a glance. */
export function LiveDot({ color, live }: { color: string; live: boolean }) {
  // Held in state rather than a ref so the React Compiler doesn't flag a ref read
  // during render; the value itself is created once and never replaced.
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!live) return;
    const animation = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => {
      animation.stop();
      pulse.setValue(0);
    };
  }, [live, pulse]);

  return (
    <View style={mapStyles.dotWrap}>
      {live && (
        <Animated.View
          style={[
            mapStyles.dotHalo,
            {
              backgroundColor: color,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) },
              ],
            },
          ]}
        />
      )}
      <View style={[mapStyles.dot, { backgroundColor: color }]} />
    </View>
  );
}

export function ControlButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: SymbolViewProps['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        mapStyles.control,
        cardShadow,
        {
          backgroundColor: active ? ACCENT : SURFACE,
          borderColor: active ? ACCENT : theme.backgroundSelected,
          opacity: pressed ? 0.75 : 1,
        },
      ]}>
      <SymbolView name={icon} size={20} tintColor={active ? SURFACE : theme.text} />
    </Pressable>
  );
}

/** Airbnb-style name pill that inverts to the accent colour when selected. */
export function PersonMarker({
  person,
  now,
  selected,
  label,
  onPress,
}: {
  person: MappedPerson;
  now: number;
  selected?: boolean;
  label?: string;
  onPress?: () => void;
}) {
  const stale = isStale(person, now);

  return (
    <Marker coordinate={coordinateOf(person)} anchor={{ x: 0.5, y: 1 }} onPress={onPress}>
      <View style={mapStyles.markerWrap}>
        <View
          style={[
            mapStyles.markerPill,
            selected && { backgroundColor: ACCENT, borderColor: ACCENT, paddingRight: Spacing.three },
          ]}>
          <View
            style={[
              mapStyles.markerAvatar,
              { backgroundColor: stale ? MUTED : ACCENT },
              selected && { backgroundColor: SURFACE },
            ]}>
            <ThemedText
              type="smallBold"
              style={[mapStyles.markerAvatarText, selected && { color: ACCENT }]}>
              {initials(person)}
            </ThemedText>
          </View>
          <ThemedText
            type="smallBold"
            style={[mapStyles.markerLabel, selected && { color: SURFACE }]}
            numberOfLines={1}>
            {label ?? person.first_name}
          </ThemedText>
        </View>
        <View style={[mapStyles.markerTail, selected && { borderTopColor: ACCENT }]} />
      </View>
    </Marker>
  );
}

export const mapStyles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  mapCard: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: SURFACE,
  },

  // Marker
  markerWrap: {
    alignItems: 'center',
  },
  markerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingLeft: Spacing.half,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: SURFACE,
    maxWidth: 170,
  },
  markerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerAvatarText: {
    color: SURFACE,
    fontSize: 11,
    lineHeight: 14,
  },
  markerLabel: {
    fontSize: 13,
    lineHeight: 16,
  },
  markerTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: SURFACE,
  },

  // Status pill
  statusPill: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
    backgroundColor: SURFACE,
  },
  dotWrap: {
    width: 8,
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotHalo: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Controls
  controls: {
    position: 'absolute',
    right: Spacing.three,
    top: Spacing.three,
    gap: Spacing.two,
  },
  control: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },

  // Bottom sheet-ish cards
  bottomCard: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 1,
    backgroundColor: SURFACE,
  },
  bottomCardBody: {
    flex: 1,
    gap: Spacing.half,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
});
