// The browser is never the phone in somebody's pocket on a chantier, so there
// is no watchdog here. A chef can still read and clear the alerts.
import { supabase } from './supabase';

export { ANSWER_WINDOW_MS, STILL_FOR_MS } from './lone-worker-watch';

export async function confirmStillFine() {
  const { error } = await supabase.rpc('confirm_lone_worker_ok');
  if (error) throw error;
}

export async function setLoneWorkerWatch(enabled: boolean) {
  const { error } = await supabase.rpc('set_lone_worker_watch', { enabled });
  if (error) throw error;
}

export type AlertKind = 'sos' | 'no_movement' | 'zone_exit';
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

export async function raiseAlert(): Promise<string | null> { return null; }

export async function resolveAlert(id: string) {
  const { error } = await supabase.rpc('resolve_safety_alert', { alert: id });
  if (error) throw error;
}

export async function fetchOpenAlerts(): Promise<OpenAlert[]> {
  const { data, error } = await supabase.rpc('open_safety_alerts');
  if (error) throw error;
  return (data ?? []) as OpenAlert[];
}

export async function fetchMyAlerts(): Promise<OpenAlert[]> { return []; }
