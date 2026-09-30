import * as Location from 'expo-location';

import { ANSWER_WINDOW_MS, STILL_FOR_MS } from './lone-worker-watch';
import { supabase } from './supabase';

export { ANSWER_WINDOW_MS, STILL_FOR_MS };

/** "Je vais bien." Clears the pending question, and any alert his silence raised. */
export async function confirmStillFine() {
  const { error } = await supabase.rpc('confirm_lone_worker_ok');
  if (error) throw error;
}

/** His own choice about being watched. No chef RPC writes it. */
export async function setLoneWorkerWatch(enabled: boolean) {
  const { error } = await supabase.rpc('set_lone_worker_watch', { enabled });
  if (error) throw error;
}

/**
 * Protection du travailleur isolé.
 *
 * A worker alone in a trench or a plant room cannot call for help if he is
 * hurt and cannot reach his phone. Two mechanisms answer that, and both need
 * the position at the moment it happens rather than the last time he opened
 * the app:
 *
 *  - the SOS he presses himself;
 *  - the watchdog: a phone that stops moving during a declared day is either
 *    a worker standing still or a worker on the ground. The app cannot tell,
 *    so it asks him, and raises an alert if he does not answer.
 *
 * The watchdog is what makes persistent location necessary, and it is decided
 * on the server: the phone reports where it is whenever it moves, and going
 * quiet is itself the alarm. It is fed by the same background updates as live
 * sharing, so it costs no extra battery, and it runs for the worker's benefit
 * whether or not his chef ever looks at the map.
 */

// Same guarded load as the presence notifications: importing
// expo-notifications inside Expo Go throws, and the watchdog must never be the
// reason a screen fails to render.
export type AlertKind = 'sos' | 'no_movement' | 'zone_exit';

/**
 * Raises an alert with the best position available. The alert is sent even if
 * the position cannot be read: knowing that somebody is in trouble matters
 * more than knowing exactly where.
 */
export async function raiseAlert(kind: AlertKind) {
  let coords: { latitude: number; longitude: number; accuracy: number | null } | null = null;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.granted) {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
    }
  } catch { /* an alert without a position is still an alert */ }

  const { data, error } = await supabase.rpc('raise_safety_alert', {
    alert_kind: kind,
    lat: coords?.latitude ?? null,
    lng: coords?.longitude ?? null,
    accuracy: coords?.accuracy ?? null,
  });
  if (error) { console.error('[lone-worker] could not raise the alert', error.message); return null; }
  return data as string;
}

export async function resolveAlert(id: string) {
  const { error } = await supabase.rpc('resolve_safety_alert', { alert: id });
  if (error) throw error;
}

export type OpenAlert = {
  id: string;
  employee_id: string;
  employee_name: string;
  site_name: string | null;
  kind: AlertKind;
  latitude: number | null;
  longitude: number | null;
  raised_at: string;
};

export async function fetchOpenAlerts(): Promise<OpenAlert[]> {
  const { data, error } = await supabase.rpc('open_safety_alerts');
  if (error) throw error;
  return (data ?? []) as OpenAlert[];
}

/** The caller's own unresolved alerts, so his phone can show what is pending. */
export async function fetchMyAlerts(employeeId: string): Promise<OpenAlert[]> {
  const { data, error } = await supabase
    .from('safety_alerts')
    .select('id, employee_id, kind, latitude, longitude, raised_at')
    .eq('employee_id', employeeId)
    .is('resolved_at', null)
    .order('raised_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, employee_name: '', site_name: null })) as OpenAlert[];
}
