// Wraps app.json so secrets can come from the environment instead of being
// committed. Expo CLI loads .env / .env.local before evaluating this file.
//
// GOOGLE_MAPS_ANDROID_API_KEY is deliberately NOT prefixed with EXPO_PUBLIC_:
// it only needs to reach AndroidManifest.xml at prebuild time, not the JS
// bundle. iOS uses Apple Maps and needs no key.
module.exports = ({ config }) => {
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

  if (!androidGoogleMapsApiKey) {
    console.warn(
      '[app.config] GOOGLE_MAPS_ANDROID_API_KEY is not set: Android map views will render blank.',
    );
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey }],
    ],
  };
};
