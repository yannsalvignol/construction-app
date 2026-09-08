import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView from 'react-native-maps';
import { Action, Card } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
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
  const copy = workCopy(locale);
  const theme = useTheme();
  const [sharedAt, setSharedAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [background, setBackground] = useState(true);
  const lock = useRef(false);

  const readShared = useCallback(async () => {
    // The read policy lets an employee see their own row and nobody else's.
    const { data } = await supabase.from('live_positions').select('recorded_at').maybeSingle();
    setSharedAt(data?.recorded_at ?? null);
    setNow(Date.now());
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
      <MapView style={{ flex: 1 }} showsUserLocation followsUserLocation />
    </View>
    <ThemedText type="smallBold" themeColor="accentText">{copy.sharedWithChef}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">
      {sharedAt ? `${copy.lastShared} : ${positionAge(sharedAt, copy, now)}` : copy.notSharedYet}
    </ThemedText>
    {/* iOS never offers "Always" on the first prompt, so this is the normal state
        for a cooperative employee, not a refusal. */}
    {!background && <ThemedText type="small" themeColor="textSecondary">{copy.foregroundOnly}</ThemedText>}
    <Action secondary label={copy.refreshPosition} busy={busy} onPress={() => { void send(); }} />
  </Card>;
}
