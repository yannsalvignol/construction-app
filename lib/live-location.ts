import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

export const LIVE_TASK = 'casprod-live-location';
export const LIVE_NOTICE_VERSION = '2026-09-08';

export type LivePosition = {
  employee_id: string; employee_name: string;
  latitude: number; longitude: number; accuracy_meters: number; recorded_at: string; site_name: string;
  /** Null when the site has no coordinates, so the question cannot be answered. */
  on_site: boolean | null; distance_meters: number | null;
};

/**
 * One call per fix, serving the watch first and the chef's map second.
 *
 * Returns whether the declared day is still open, which is the only reason the
 * task has to keep running. A failure — no signal, server down — is not an
 * answer, and is reported as "keep going": a worker in a basement with no bars
 * is exactly the worker the watch exists for.
 */
async function heartbeat(fix: { latitude: number; longitude: number; accuracy: number | null } | null) {
  const { data, error } = await supabase.rpc('safety_heartbeat', {
    lat: fix?.latitude ?? null,
    lng: fix?.longitude ?? null,
    accuracy: fix?.accuracy ?? null,
  });
  if (error) return true;
  return (data as { day_open?: boolean } | null)?.day_open !== false;
}

/**
 * Runs outside React, including while the app is backgrounded.
 *
 * Protection du travailleur isolé is what this task is for. It reports where the
 * phone is whenever it moves, and that is all it does: the server holds the
 * deadline and treats silence as the signal, because a phone lying next to an
 * unconscious man runs no code at all. Live sharing, when the chef has turned it
 * on and the worker has agreed, rides the same fixes and costs no extra battery.
 */
TaskManager.defineTask(LIVE_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations;
  const last = locations?.[locations.length - 1];
  if (!last) return;

  // Nobody signed in: no worker to watch over, and no agreement to rely on.
  // Sign-out and account deletion both stop the task directly, but the OS keeps
  // delivering to a registered task across app restarts, so this is the backstop
  // for the paths that miss — a session that expired, a reinstall, a crash
  // between the sign-out and the stop. Read from storage, so being offline does
  // not look like being signed out.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { await stopSafetyWatch(); return; }

  const open = await heartbeat({
    latitude: last.coords.latitude,
    longitude: last.coords.longitude,
    accuracy: last.coords.accuracy,
  });
  // The day is over, or this account has no business being watched. Nothing left
  // to watch over, so stop waking the phone.
  if (!open) await stopSafetyWatch();
});

/**
 * Sends one position immediately. Background updates alone are not enough: on iOS
 * `timeInterval` is ignored and only `distanceInterval` applies, so somebody who
 * stays put on a site would never emit a point — neither to the chef's map nor,
 * more importantly, to the watch that is meant to notice he stopped moving.
 */
export async function pushCurrentPosition() {
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return await heartbeat({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
  } catch { return false; }
}

export async function isSafetyWatchRunning() {
  try { return await Location.hasStartedLocationUpdatesAsync(LIVE_TASK); }
  catch { return false; }
}

/**
 * Starts the position feed and returns whether anything is running at all.
 *
 * Foreground permission is the only hard requirement. Background permission is
 * asked for but not required: iOS commonly grants "While Using" first, and
 * refusing to do anything in that case would leave the worker unwatched and
 * invisible to his chef both. Without it the watch only runs while the app is
 * open — which is worth saying plainly in the UI, since the whole point is the
 * phone in a pocket.
 */
export async function startSafetyWatch() {
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return false;
    // Background permission must be requested after foreground on both platforms.
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.granted && !await isSafetyWatchRunning()) {
      await Location.startLocationUpdatesAsync(LIVE_TASK, {
        accuracy: Location.Accuracy.Balanced,
        // Android honours timeInterval; iOS only reacts to distance, hence the
        // foreground heartbeat that keeps a stationary worker current.
        timeInterval: 120_000,
        distanceInterval: 25,
        pausesUpdatesAutomatically: false,
        // The iOS status-bar indicator stays on so the worker can always see the
        // watch is running; the Android notification does the same.
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Protection du travailleur isolé active',
          notificationBody: 'Votre position est surveillée pendant votre journée déclarée, et partagée avec votre chef s’il a activé la carte.',
        },
      });
    }
    // Start the watch from a known position now rather than at the first 25 m
    // moved, and reach the chef's map at the same time.
    await pushCurrentPosition();
    return true;
  } catch { return false; }
}

/** Whether the OS will keep reporting while the app is closed. */
export async function hasBackgroundLocation() {
  try { return (await Location.getBackgroundPermissionsAsync()).granted; }
  catch { return false; }
}

export async function stopSafetyWatch() {
  try { if (await isSafetyWatchRunning()) await Location.stopLocationUpdatesAsync(LIVE_TASK); }
  catch { /* the task may already be gone; nothing to unwind */ }
}

export async function fetchLiveTeam(): Promise<LivePosition[]> {
  const { data, error } = await supabase.rpc('live_team');
  if (error) throw error;
  return (data ?? []) as LivePosition[];
}
