import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

export const LIVE_TASK = 'casprod-live-location';
export const LIVE_NOTICE_VERSION = '2026-09-08';

export type LivePosition = {
  employee_id: string; employee_name: string;
  latitude: number; longitude: number; accuracy_meters: number; recorded_at: string; site_name: string;
};

/**
 * Runs outside React, including while the app is backgrounded. Every guard that
 * matters (mode still 'live', consent still given, day still open) is enforced by
 * update_live_position server-side, so a rejected point simply stops the task
 * rather than being retried against a state the client cannot verify.
 */
TaskManager.defineTask(LIVE_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  const last = locations?.[locations.length - 1];
  if (!last) return;
  const { error: failure } = await supabase.rpc('update_live_position', {
    lat: last.coords.latitude,
    lng: last.coords.longitude,
    accuracy: last.coords.accuracy ?? 0,
  });
  // The server refuses once sharing no longer applies; stop rather than keep waking.
  if (failure) await stopLiveLocation();
});

/**
 * Sends one position immediately. Background updates alone are not enough: on iOS
 * `timeInterval` is ignored and only `distanceInterval` applies, so somebody who
 * stays put on a site would never emit a point and would never reach the map.
 */
export async function pushCurrentPosition() {
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { error } = await supabase.rpc('update_live_position', {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy ?? 0,
    });
    return !error;
  } catch { return false; }
}

export async function isLiveLocationRunning() {
  try { return await Location.hasStartedLocationUpdatesAsync(LIVE_TASK); }
  catch { return false; }
}

/**
 * Starts sharing and returns whether anything is being shared at all.
 *
 * Foreground permission is the only hard requirement. Background permission is
 * asked for but not required: iOS commonly grants "While Using" first, and
 * refusing to share anything in that case left the employee invisible to their
 * chef entirely. Without it the position still goes out whenever the app is
 * open, and the chef keeps seeing the last known one in between.
 */
export async function startLiveLocation() {
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return false;
    // Background permission must be requested after foreground on both platforms.
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.granted && !await isLiveLocationRunning()) {
      await Location.startLocationUpdatesAsync(LIVE_TASK, {
        accuracy: Location.Accuracy.Balanced,
        // Android honours timeInterval; iOS only reacts to distance, hence the
        // foreground heartbeat that keeps a stationary worker current.
        timeInterval: 120_000,
        distanceInterval: 25,
        pausesUpdatesAutomatically: false,
        // The iOS status-bar indicator stays on so the employee can always see
        // that sharing is active; the Android notification does the same.
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Partage de position actif',
          notificationBody: 'Votre position est partagée avec votre chef pendant votre journée déclarée.',
        },
      });
    }
    // Reach the chef's map now rather than at the first 25 m moved.
    await pushCurrentPosition();
    return true;
  } catch { return false; }
}

/** Whether the OS will keep reporting while the app is closed. */
export async function hasBackgroundLocation() {
  try { return (await Location.getBackgroundPermissionsAsync()).granted; }
  catch { return false; }
}

export async function stopLiveLocation() {
  try { if (await isLiveLocationRunning()) await Location.stopLocationUpdatesAsync(LIVE_TASK); }
  catch { /* the task may already be gone; nothing to unwind */ }
}

export async function fetchLiveTeam(): Promise<LivePosition[]> {
  const { data, error } = await supabase.rpc('live_team');
  if (error) throw error;
  return (data ?? []) as LivePosition[];
}
