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

export async function isLiveLocationRunning() {
  try { return await Location.hasStartedLocationUpdatesAsync(LIVE_TASK); }
  catch { return false; }
}

/** Returns false when the employee declines either permission; never throws. */
export async function startLiveLocation() {
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return false;
    // Background permission must be requested after foreground on both platforms.
    const background = await Location.requestBackgroundPermissionsAsync();
    if (!background.granted) return false;
    if (await isLiveLocationRunning()) return true;
    await Location.startLocationUpdatesAsync(LIVE_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 120_000,
      distanceInterval: 50,
      pausesUpdatesAutomatically: false,
      // The iOS status-bar indicator stays on so the employee can always see that
      // sharing is active; the Android notification serves the same purpose.
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Partage de position actif',
        notificationBody: 'Votre position est partagée avec votre chef pendant votre journée déclarée.',
      },
    });
    return true;
  } catch { return false; }
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
