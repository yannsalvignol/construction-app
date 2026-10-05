// Wraps app.json so secrets can come from the environment instead of being
// committed. Expo CLI loads .env / .env.local before evaluating this file.
//
// Two Maps keys, one per platform, because a Google Cloud key carries exactly
// ONE application restriction: a key restricted to Android packages cannot
// also be restricted to iOS bundle ids. Sharing one key between the platforms
// therefore means leaving it unrestricted, and an unrestricted Maps key is a
// billing account anyone who opens the binary can spend against.
//
// Neither is prefixed with EXPO_PUBLIC_: they reach AndroidManifest.xml and
// Info.plist at prebuild time and are never needed in the JS bundle. Both end
// up readable inside the shipped binary all the same — that is what a client
// Maps key is, and why the restriction is the protection rather than secrecy.
//
// The Places key is a third one and is NOT here: it is server-side, held as a
// Supabase secret and used only by the place-search function, so it never
// reaches a phone at all.
//
// iOS renders through Google, not Apple. Not a technical preference: the two
// draw Morocco's borders differently, and an app used by Moroccan crews on
// Moroccan chantiers shows the country as its users understand it.
module.exports = ({ config }) => {
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const iosGoogleMapsApiKey = process.env.GOOGLE_MAPS_IOS_API_KEY;

  for (const [name, value] of [
    ['GOOGLE_MAPS_ANDROID_API_KEY', androidGoogleMapsApiKey],
    ['GOOGLE_MAPS_IOS_API_KEY', iosGoogleMapsApiKey],
  ]) {
    if (!value) {
      console.warn(`[app.config] ${name} is not set: that platform's maps will render blank.`);
    }
  }

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey, iosGoogleMapsApiKey }],
    ],
  };
};
