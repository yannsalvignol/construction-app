import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { SymbolView } from 'expo-symbols';
import { Action } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { addressAt, currentPosition, MOROCCO_REGION } from '@/lib/geocode';
import { workCopy } from '@/lib/work-copy';

const CLOSE_UP = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

/**
 * The pin is fixed at the centre and the map moves under it, which is far easier
 * one-handed than dragging a marker. Whatever the pin lands on is reverse-geocoded,
 * so the stored address is one Apple Maps produced rather than something typed.
 */
export function SitePicker({ onChange }: {
  onChange: (value: { latitude: number; longitude: number; address: string } | null) => void;
}) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const map = useRef<MapView | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [denied, setDenied] = useState(false);
  const lookup = useRef(0);
  const [home, setHome] = useState<{ latitude: number; longitude: number } | null>(null);

  const resolve = useCallback(async (latitude: number, longitude: number) => {
    const sequence = ++lookup.current;
    setResolving(true);
    try {
      const found = await addressAt(latitude, longitude);
      if (sequence !== lookup.current) return;
      setAddress(found);
      onChange(found ? { latitude, longitude, address: found } : null);
    } catch {
      if (sequence !== lookup.current) return;
      setAddress(null); onChange(null);
    } finally { if (sequence === lookup.current) setResolving(false); }
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const position = await currentPosition();
      if (cancelled) return;
      if (!position) { setDenied(true); setResolving(false); return; }
      setHome(position);
      map.current?.animateToRegion({ ...position, ...CLOSE_UP }, 600);
      void resolve(position.latitude, position.longitude);
    })();
    return () => { cancelled = true; };
  }, [resolve]);

  // onRegionChangeComplete only fires once the gesture settles, which keeps the
  // geocoder from being hit on every frame of a pan.
  function settled(region: Region) {
    void resolve(region.latitude, region.longitude);
  }

  return <View style={{ gap: 10 }}>
    <View style={{ height: 260, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      <MapView ref={map} style={{ flex: 1 }} initialRegion={MOROCCO_REGION} onRegionChangeComplete={settled} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        {/* Sits half a pin above centre so the point, not the head, marks the spot. */}
        <View style={{ marginBottom: 28 }}>
          <SymbolView name={{ ios: 'mappin', android: 'location_on', web: 'location_on' }} size={36} tintColor={theme.accent} />
        </View>
      </View>
    </View>
    <ThemedText type="small" themeColor="textSecondary">{copy.siteAddressHint}</ThemedText>
    {denied && <ThemedText type="small" themeColor="warning">{copy.pinPermission}</ThemedText>}
    <ThemedText type="smallBold">
      {resolving ? copy.pinLocating : address ?? copy.pinNoAddress}
    </ThemedText>
    {home && <Action secondary label={copy.pinUseMyLocation} onPress={() => {
      map.current?.animateToRegion({ ...home, ...CLOSE_UP }, 500);
    }} />}
  </View>;
}
