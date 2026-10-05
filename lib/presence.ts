import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { decode } from 'base64-arraybuffer';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { workCopy } from './work-copy';
import type { Locale } from './i18n/locale';

export type Site = { id: string; name: string; address: string | null; is_active: boolean; latitude: number | null; longitude: number | null;
  /** Lines and operations the chef named this worker on there, still unfinished. */
  awaiting?: number };
export type WorkDay = { id: string; site_id: string; work_date: string; started_at: string; planned_end_at: string; ended_at: string | null;
  seconds_inside: number; seconds_outside: number };
export type PresenceRequest = { id: string; due_at: string; expires_at: string };
export type CheckIn = { id: string; request_id: string; site_id: string; employee_id: string; photo_path: string; submitted_at: string; latitude: number; longitude: number; accuracy_meters: number };
export type TaskUnit = 'unit' | 'm' | 'm2' | 'm3' | 'kg';
export type TaskCode = { code: string; category_code: string; label_fr: string; label_en: string; unit: TaskUnit };
export type Declaration = { id: string; task_code: string; quantity: number };
export type Workspace = {
  server_time: string; date: string; day: WorkDay | null;
  consent: { notice_version: string; revoked_at: string | null } | null;
  location_mode: 'checkpoint' | 'live';
  live_consent: { notice_version: string; revoked_at: string | null } | null;
  /** Protection du travailleur isolé: his own choice, and whether the server is
   *  currently waiting for him to say he is alright. */
  lone_worker_watch: boolean;
  lone_worker_asked: boolean;
  /** Whether the company runs the automatic watch at all. False and the
   *  worker's own switch decides nothing: the phone stops reporting for it
   *  and the card stops claiming to watch over him. */
  lone_worker_available?: boolean;
  /** What the chef requires before this man may start a day. */
  equipment_photo_required?: boolean;
  clock_in_photo_required?: boolean;
  sites: Site[]; requests: PresenceRequest[]; checks: CheckIn[]; declarations: Declaration[];
  categories: { code: string; label_fr: string; label_en: string }[]; codes: TaskCode[];
};
export type Dashboard = {
  date: string; employees: number; active_employees: number; confirmed: number; to_review: number; declared_hours: number; declarations: number; contributors: number;
  productivity: { code: string; label_fr: string; label_en: string; unit: TaskUnit; quantity: number; employees: number }[];
  /** Today's chantiers (any open or closed work day), with what was declared on each. */
  sites: { site_id: string; site_name: string; workers: number; declared_hours: number;
    tasks: { code: string; label_fr: string; label_en: string; unit: TaskUnit; quantity: number; employees: number }[] }[];
  flags: { employee_id: string; employee_name: string; label_fr: string; label_en: string; quantity: number; unit: TaskUnit; site_name: string }[];
};
export const NOTICE_VERSION = '2026-09-07';

/**
 * A photo the chef requires before a day may start.
 *
 * Taken before the day exists, so there is nothing to attach it to yet: it is
 * uploaded, and start_work_day stores the path in the same transaction as the
 * day it conditions. A start that fails leaves the upload orphaned, which the
 * worker may delete and nobody else can read.
 *
 * Returns null when he backs out of the camera — that is a decision not to
 * start the day, not a failure.
 */
export async function captureDayProof(
  kind: 'equipment' | 'clock_in',
  employeeId: string,
  locale: Locale
): Promise<{ path: string; latitude: number; longitude: number; accuracy: number } | null> {
  const copy = workCopy(locale);
  if (Platform.OS === 'web') throw new Error(copy.nativeOnly);
  const camera = await ImagePicker.requestCameraPermissionsAsync();
  if (!camera.granted) throw new Error(copy.cameraDenied);
  const photo = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'], quality: 0.5, base64: true, allowsEditing: false, exif: false,
  });
  if (photo.canceled) return null;
  const asset = photo.assets[0];
  if (!asset.base64) throw new Error(copy.proofFailed);

  // Where it was taken, when the phone will say. A refused permission does not
  // block the day: the photo is the proof the chef asked for, the position is
  // a bonus, and trading one for the other would mean no proof at all.
  let where: { latitude: number; longitude: number; accuracy: number } | null = null;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.granted) {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (position.coords.accuracy != null) {
        where = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
      }
    }
  } catch { /* the photo stands on its own */ }

  const isPng = asset.mimeType === 'image/png';
  const path = `${employeeId}/${kind}-${Date.now()}.${isPng ? 'png' : 'jpg'}`;
  const { error } = await supabase.storage
    .from('day-proofs')
    .upload(path, decode(asset.base64), { contentType: isPng ? 'image/png' : 'image/jpeg', upsert: false });
  if (error) throw new Error(copy.proofFailed);
  return { path, latitude: where?.latitude ?? 0, longitude: where?.longitude ?? 0, accuracy: where?.accuracy ?? 0 };
}

/** Called only by an explicit check-in button. No watchers, last-known fixes or background permissions. */
export async function capturePresence(requestId: string, employeeId: string, locale: Locale) {
  const copy = workCopy(locale);
  if (Platform.OS === 'web') throw new Error(copy.nativeOnly);
  const camera = await ImagePicker.requestCameraPermissionsAsync();
  if (!camera.granted) throw new Error(copy.cameraDenied);
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error(copy.locationDenied);
  const photo = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, base64: true, allowsEditing: false, exif: false });
  if (photo.canceled) return false;
  const asset = photo.assets[0];
  if (!asset.base64) throw new Error(copy.proofFailed);
  const captured = new Date().toISOString();
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  if (Date.now() - Date.parse(captured) > 90_000 || position.coords.accuracy == null) throw new Error(copy.proofFailed);
  const isPng = asset.mimeType === 'image/png';
  const path = `${employeeId}/${requestId}/${Date.now()}.${isPng ? 'png' : 'jpg'}`;
  const { error: uploadError } = await supabase.storage.from('presence-proofs').upload(path, decode(asset.base64), { contentType: isPng ? 'image/png' : 'image/jpeg', upsert: false });
  if (uploadError) throw new Error(copy.proofFailed);
  const { error } = await supabase.rpc('submit_presence_check', {
    request: requestId, photo: path, captured,
    lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy,
  });
  if (error) {
    // Submitted evidence cannot be deleted by employees. Unattached failed uploads can.
    await supabase.storage.from('presence-proofs').remove([path]);
    throw new Error(copy.proofFailed);
  }
  return true;
}
