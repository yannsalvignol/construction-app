import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { supabase } from '@/lib/supabase';

/**
 * Profile photographs: shrunk before they are sent, never after.
 *
 * The picker was asked for quality 0.6 and nothing else, so what left the
 * phone was a full-resolution square off the camera roll — around three
 * thousand pixels on a side, four hundred kilobytes and more — to be drawn as
 * a forty-six point circle in a list. Measured on the live bucket: four
 * avatars, 425 kB on average, the largest 632 kB, for roughly sixty times the
 * pixels any screen in the app asks for. That is the chef's data allowance on
 * a chantier, and the employees tab downloading one per row.
 *
 * 512 is twice the largest avatar the app draws on a three-times screen, so
 * there is room for a bigger one later without going back to the camera roll.
 */
const SIDE = 512;
/** Past this the file grows and the circle does not change. */
const QUALITY = 0.8;

/** One file per person, replaced in place: upsert at a fixed path means a new
 *  photograph overwrites the old bytes rather than leaving them behind. */
export const avatarPath = (profileId: string) => `${profileId}/avatar.jpg`;

/**
 * Resizes, re-encodes, and returns the bytes to upload.
 *
 * Square already — the picker crops to 1:1 — so one dimension is enough and
 * the ratio carries the other.
 */
export async function shrinkAvatar(uri: string): Promise<string> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: SIDE }).renderAsync();
  const saved = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error('Could not read the resized photo');
  return saved.base64;
}

/**
 * Removes a profile's photograph from storage.
 *
 * Replacing one does not need this — the upload overwrites it — but a chef
 * clearing his photo does, and so does anything that leaves a file with
 * nobody to own it.
 */
export async function removeAvatar(profileId: string) {
  await supabase.storage.from('avatars').remove([avatarPath(profileId)]);
}
