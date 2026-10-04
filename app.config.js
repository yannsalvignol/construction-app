// Wraps app.json so secrets can come from the environment instead of being
// committed. Expo CLI loads .env / .env.local before evaluating this file.
//
// The key is not prefixed with EXPO_PUBLIC_: it only needs to reach
// AndroidManifest.xml and Info.plist at prebuild time, not the JS bundle.
//
// One key for both platforms. The name says ANDROID for historical reasons —
// iOS used Apple Maps and needed nothing — and renaming it means setting a new
// EAS secret, which is a worse trade than a misleading name with this comment
// under it. The per-platform restriction belongs in Google Cloud anyway, where
// one key can allow both the Android package and the iOS bundle id.
//
// iOS uses Google Maps too now, not Apple's. Not a technical preference: the
// two draw Morocco's borders differently, and an app used by Moroccan crews on
// Moroccan chantiers shows the country as its users understand it.
module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

  if (!googleMapsApiKey) {
    console.warn(
      '[app.config] GOOGLE_MAPS_ANDROID_API_KEY is not set: map views will render blank on both platforms.',
    );
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        'react-native-maps',
        { androidGoogleMapsApiKey: googleMapsApiKey, iosGoogleMapsApiKey: googleMapsApiKey },
      ],
    ],
  };
};
