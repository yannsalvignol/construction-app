import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from './use-auth';
import { useI18n } from './use-i18n';
import { supabase } from '@/lib/supabase';
import { NOTICE_VERSION, type Workspace } from '@/lib/presence';
import { LIVE_NOTICE_VERSION, pushCurrentPosition, startSafetyWatch, stopSafetyWatch } from '@/lib/live-location';
import { enablePresenceNotifications, onPresenceNotification } from '@/lib/presence-notifications';
import { workCopy } from '@/lib/work-copy';

/**
 * `manageSharing` is false for callers that only need to read the workspace, so the
 * live-sharing lifecycle is driven by exactly one instance even when the gate and a
 * screen are mounted together.
 */
export function useWorkspace({ manageSharing = true }: { manageSharing?: boolean } = {}) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const userId = profile?.id;
  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const { data: next, error: fetchError } = await supabase.rpc('employee_workspace');
      if (fetchError) throw fetchError;
      offset.current = Date.parse(next.server_time) - Date.now();
      setNow(Date.now() + offset.current);
      setData(next as Workspace);
      setError(null);
    } catch { setError(workCopy(locale).failed); }
    finally { setLoading(false); }
  }, [userId, locale]);
  useFocusEffect(useCallback(() => {
    void refresh();
    // This only refreshes server requests; it never reads device location.
    const interval = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, [refresh]));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const remove = onPresenceNotification(() => { void refresh(); });
    return () => { clearInterval(timer); app.remove(); remove(); };
  }, [refresh]);
  const consented = data?.consent?.notice_version === NOTICE_VERSION && !data.consent.revoked_at;
  useEffect(() => { if (consented) void enablePresenceNotifications(locale, false); }, [consented, locale]);
  const liveConsented = data?.live_consent?.notice_version === LIVE_NOTICE_VERSION && !data.live_consent.revoked_at;
  const liveEligible = data?.location_mode === 'live' && !!liveConsented;
  const dayOpen = !!data?.day && !data.day.ended_at && Date.parse(data.day.planned_end_at) > now;
  // The position feed belongs to the declared day, not to the chef's map. It runs
  // for protection du travailleur isolé whenever the worker has a day open and has
  // not turned the watch off; live sharing, when it applies, rides the same fixes.
  // Either way it is torn down the moment the day closes.
  // The server decides whether he is still; the phone only has to keep reporting.
  const watchEnabled = data?.lone_worker_watch !== false;
  const watching = dayOpen && (watchEnabled || liveEligible);
  useEffect(() => {
    if (!manageSharing) return;
    if (!watching) { void stopSafetyWatch(); return; }
    void startSafetyWatch();
    // iOS only emits background updates on movement, so a worker standing still on
    // a site would never emit a fix — he would age out of the chef's map, and the
    // watch would never learn he had stopped. While the app is open, refresh on a
    // timer instead.
    const beat = setInterval(() => {
      if (AppState.currentState === 'active') void pushCurrentPosition();
    }, 120_000);
    return () => clearInterval(beat);
  }, [watching, manageSharing]);
  return { data, error, loading, refresh, now, consented, liveConsented, liveEligible, watchEnabled, watching };
}
