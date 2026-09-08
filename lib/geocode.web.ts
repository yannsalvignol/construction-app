export type LocatedAddress = { latitude: number; longitude: number; address: string };

export class GeocodingUnavailable extends Error {}

export const MOROCCO_REGION = {
  latitude: 31.7917, longitude: -7.0926, latitudeDelta: 12, longitudeDelta: 12,
};

// expo-location's geocoder has no web implementation. Rather than silently
// falling back to a different provider, whose addresses would not match what the
// mobile app resolves, the web build refuses to create sites and says so.
export function formatAddress(): string { return ''; }
export async function requestLocationPermission() { return false; }
export async function currentPosition() { return null; }
export async function addressAt(): Promise<string | null> {
  throw new GeocodingUnavailable('reverse geocoding is unavailable on web');
}
