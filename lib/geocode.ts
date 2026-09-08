import * as Location from 'expo-location';

export type LocatedAddress = { latitude: number; longitude: number; address: string };

/** Thrown when the platform cannot geocode at all, as opposed to finding nothing. */
export class GeocodingUnavailable extends Error {}

/** Morocco, used until the device reports where it actually is. */
export const MOROCCO_REGION = {
  latitude: 31.7917, longitude: -7.0926, latitudeDelta: 12, longitudeDelta: 12,
};

/**
 * iOS exposes no `formattedAddress`, so the line is composed from the parts
 * CLGeocoder returns. Empty parts are dropped rather than leaving stray commas.
 */
export function formatAddress(parts: Location.LocationGeocodedAddress) {
  const street = [parts.streetNumber, parts.street ?? parts.name].filter(Boolean).join(' ');
  const town = [parts.postalCode, parts.city ?? parts.subregion].filter(Boolean).join(' ');
  const line = [street, town, parts.region, parts.country]
    .map(part => part?.trim())
    .filter((part): part is string => !!part);
  // The same word can arrive as both name and city on sparse rural results.
  return [...new Set(line)].join(', ');
}

export async function requestLocationPermission() {
  const permission = await Location.requestForegroundPermissionsAsync();
  return permission.granted;
}

/** Returns null when the device position is unavailable or refused. */
export async function currentPosition() {
  try {
    if (!await requestLocationPermission()) return null;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch { return null; }
}

/**
 * Resolves whatever the pin sits on through the platform geocoder — CLGeocoder on
 * iOS — so a stored address is always one Apple Maps itself produced.
 */
export async function addressAt(latitude: number, longitude: number): Promise<string | null> {
  const matches = await Location.reverseGeocodeAsync({ latitude, longitude });
  const first = matches[0];
  if (!first) return null;
  const address = formatAddress(first);
  return address || null;
}
