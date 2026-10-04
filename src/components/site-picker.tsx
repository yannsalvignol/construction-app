import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Action } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { addressAt, currentPosition, MOROCCO_REGION } from '@/lib/geocode';
import {
  newSearchSession, resolveAddress, suggestAddresses, type PlaceSuggestion,
} from '@/lib/address-search';
import { workCopy } from '@/lib/work-copy';

const CLOSE_UP = { latitudeDelta: 0.004, longitudeDelta: 0.004 };
/** Long enough that a pause in typing is over, short enough to feel immediate. */
const TYPING_SETTLE_MS = 300;

/**
 * Two ways to the same answer, because chefs have both problems.
 *
 * Typing is the usual one: he knows the address and wants the map to go there,
 * with real addresses offered as he writes. Dropping a pin is for the chantier
 * that has no address yet — a plot, a site entrance round the back — where the
 * only honest answer is the position itself.
 *
 * The pin is fixed at the centre and the map moves under it, which is far easier
 * one-handed than dragging a marker.
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

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);
  // Where the map is now, so suggestions are biased to the region he is looking at.
  const centre = useRef<{ latitude: number; longitude: number } | null>(null);
  const session = useRef(newSearchSession());
  // Set while a suggestion is being applied, so the map move it causes is not
  // mistaken for the chef panning away from it.
  const applying = useRef(false);
  const search = useRef(0);

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
      centre.current = position;
      map.current?.animateToRegion({ ...position, ...CLOSE_UP }, 600);
      void resolve(position.latitude, position.longitude);
    })();
    return () => { cancelled = true; };
  }, [resolve]);

  // Typing is debounced: one request per pause, not per character. Every state
  // change happens inside the timer rather than in the effect body, so typing a
  // character does not set state during the render it came from.
  useEffect(() => {
    const text = query.trim();
    const sequence = ++search.current;
    const timer = setTimeout(() => {
      if (text.length < 3) {
        setSuggestions([]); setSearching(false); setSearchFailed(null);
        return;
      }
      setSearching(true);
      void (async () => {
        try {
          // Dev only: a silent failure here is indistinguishable from a request
          // that never left, and the two have different causes.
          if (__DEV__) console.log('[site-picker] searching', JSON.stringify(text), 'near', centre.current);
          const found = await suggestAddresses(text, {
            near: centre.current,
            session: session.current,
            locale,
          });
          if (__DEV__) console.log('[site-picker] got', found.length, 'suggestions');
          if (sequence !== search.current) return;
          setSuggestions(found);
          setSearchFailed(null);
        } catch (failure) {
          if (sequence !== search.current) return;
          setSuggestions([]);
          // The reason, not a generic sentence: a Supabase failure is a plain
          // object, so the usual `instanceof Error` test throws away whatever
          // the server said and leaves nobody able to tell why.
          const reason = failure instanceof Error
            ? failure.message
            : typeof (failure as { message?: unknown })?.message === 'string'
              ? (failure as { message: string }).message
              : String(failure);
          console.error('[site-picker] address search failed:', reason);
          setSearchFailed(reason);
        } finally {
          if (sequence === search.current) setSearching(false);
        }
      })();
    }, TYPING_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [query, locale, session]);

  async function pick(suggestion: PlaceSuggestion) {
    setSuggestions([]);
    setQuery('');
    setResolving(true);
    applying.current = true;
    try {
      const place = await resolveAddress(suggestion.id);
      centre.current = { latitude: place.latitude, longitude: place.longitude };
      map.current?.animateToRegion({ ...centre.current, ...CLOSE_UP }, 600);
      // Google's own formatting of the address he chose, rather than reverse
      // geocoding the pin we just moved — he picked this line, so keep it.
      const line = place.address || [suggestion.label, suggestion.detail].filter(Boolean).join(', ');
      setAddress(line);
      onChange({ latitude: place.latitude, longitude: place.longitude, address: line });
    } catch {
      setSearchFailed(copy.siteAddressSearchFailed);
      applying.current = false;
    } finally {
      setResolving(false);
      // The animation's settle fires after this; let it pass before listening again.
      setTimeout(() => { applying.current = false; }, 1200);
    }
    // A new token for the next run of typing: the session Google billed is spent.
    session.current = newSearchSession();
  }

  // onRegionChangeComplete only fires once the gesture settles, which keeps the
  // geocoder from being hit on every frame of a pan.
  function settled(region: Region) {
    centre.current = { latitude: region.latitude, longitude: region.longitude };
    // Moving the map to a chosen address must not overwrite that address with
    // whatever the reverse geocoder makes of the same spot.
    if (applying.current) return;
    void resolve(region.latitude, region.longitude);
  }

  return <View style={{ gap: 10 }}>
    <View style={{ gap: 8 }}>
      {/* The second field of the form, and the one that does something quite
          different from the first: it searches rather than records. */}
      <ThemedText type="smallBold">{copy.siteAddress}</ThemedText>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        borderWidth: 1, borderColor: theme.backgroundSelected, borderRadius: 12,
        backgroundColor: theme.backgroundElement, paddingHorizontal: 12, minHeight: 48,
      }}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          allowFontScaling={false}
          value={query}
          onChangeText={setQuery}
          placeholder={copy.siteAddressSearch}
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
          style={{ flex: 1, color: theme.text, fontSize: 16, paddingVertical: 12 }}
        />
        {searching && <ActivityIndicator size="small" color={theme.textSecondary} />}
        {!searching && !!query && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.cancel}
            hitSlop={8}
            onPress={() => { setQuery(''); setSuggestions([]); }}>
            <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>

      {suggestions.length > 0 && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{
            maxHeight: 190,
            borderWidth: 1, borderColor: theme.backgroundSelected, borderRadius: 12,
            backgroundColor: theme.backgroundElement,
          }}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              accessibilityRole="button"
              onPress={() => { void pick(suggestion); }}
              style={({ pressed }) => [
                { paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
                pressed && { opacity: 0.6 },
              ]}>
              <Ionicons name="location-outline" size={16} color={theme.textSecondary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThemedText numberOfLines={1}>{suggestion.label}</ThemedText>
                {!!suggestion.detail && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {suggestion.detail}
                  </ThemedText>
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {!!searchFailed && (
        <ThemedText type="small" themeColor="warning">{searchFailed}</ThemedText>
      )}
    </View>

    <View style={{ height: 260, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: theme.backgroundSelected }}>
      <MapView provider={PROVIDER_GOOGLE} ref={map} style={{ flex: 1 }} initialRegion={MOROCCO_REGION} onRegionChangeComplete={settled} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        {/* Sits half a pin above centre so the point, not the head, marks the spot. */}
        <View style={{ marginBottom: 28 }}>
          <Ionicons name="location" size={36} color={theme.accent} />
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
