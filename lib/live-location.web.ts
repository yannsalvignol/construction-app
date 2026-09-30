import { supabase } from './supabase';

export const LIVE_TASK = 'casprod-live-location';
export const LIVE_NOTICE_VERSION = '2026-09-08';

export type LivePosition = {
  employee_id: string; employee_name: string;
  latitude: number; longitude: number; accuracy_meters: number; recorded_at: string; site_name: string;
  on_site: boolean | null; distance_meters: number | null;
};

// Background location needs a native task runner, so the web build never shares.
// A chef can still read the team's positions from a browser.
export async function pushCurrentPosition() { return false; }
export async function isSafetyWatchRunning() { return false; }
export async function startSafetyWatch() { return false; }
export async function hasBackgroundLocation() { return false; }
export async function stopSafetyWatch() { /* nothing runs on web */ }

export async function fetchLiveTeam(): Promise<LivePosition[]> {
  const { data, error } = await supabase.rpc('live_team');
  if (error) throw error;
  return (data ?? []) as LivePosition[];
}
