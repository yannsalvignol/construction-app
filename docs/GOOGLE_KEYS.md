# The three Google keys

Three, not one, because a Google Cloud key carries exactly **one** application
restriction. A key restricted to Android packages cannot also be restricted to
iOS bundle ids. Sharing one key across platforms therefore means leaving it
unrestricted — and an unrestricted Maps key is a billing account that anyone
who opens the binary can spend against.

| key | lives in | restricted by | used for |
|---|---|---|---|
| Maps — iOS | EAS env `GOOGLE_MAPS_IOS_API_KEY` | iOS bundle id | the map in the app |
| Maps — Android | EAS env `GOOGLE_MAPS_ANDROID_API_KEY` | package + SHA‑1 | the map in the app |
| Places | Supabase secret `GOOGLE_PLACES_API_KEY` | API only | address search, server-side |

The two Maps keys end up **inside the shipped binary**. That is what a client
Maps key is; it cannot be hidden. The restriction is the protection, not
secrecy. The Places key is the opposite: it never leaves the server, so it is
secret and needs no app restriction.

---

## 1. Maps — iOS

Google Cloud Console → **APIs & Services** → **Credentials** → *Create
credentials* → *API key*. Rename it `casprod-maps-ios`.

**Application restrictions** → **iOS apps** → add bundle id:

```
com.casprod.app
```

**API restrictions** → *Restrict key* → tick **Maps SDK for iOS** and nothing
else.

Then make sure the SDK is enabled on the project at all: **APIs & Services** →
**Library** → *Maps SDK for iOS* → **Enable**. Enabling it in the library and
ticking it on the key are two different things and both are required.

```bash
npx eas-cli env:create --name GOOGLE_MAPS_IOS_API_KEY --value "AIza..." \
  --environment production --visibility sensitive
```

## 2. Maps — Android

A second key, `casprod-maps-android`.

**Application restrictions** → **Android apps** → add:

```
package name: com.casprod.app
SHA-1:        (see below)
```

**API restrictions** → **Maps SDK for Android** only.
**Library** → *Maps SDK for Android* → **Enable**.

The SHA‑1 is the one EAS signs with, not a local debug keystore:

```bash
npx eas-cli credentials --platform android
```

Pick the production build profile and read the keystore's SHA‑1 fingerprint.
A local `expo run:android` build is signed with a **different** debug keystore,
so add that fingerprint too if you want maps to work in local Android dev.

```bash
npx eas-cli env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value "AIza..." \
  --environment production --visibility sensitive
```

## 3. Places — server side

A third key, `casprod-places-server`. It is used by the `place-search` edge
function, never by the app.

**Application restrictions** → **None**. Supabase Edge Functions have no
static IP to restrict to, which is exactly why this key must never be given an
app restriction and must never be shipped in a binary.

**API restrictions** → **Places API** only. That single restriction is what
limits the damage if it ever leaks.

```bash
npx supabase secrets set GOOGLE_PLACES_API_KEY="AIza..."
```

No redeploy needed: the function reads it per invocation.

---

## After rotating any of them

A Maps key is baked in at **prebuild** time, so changing it needs a new native
build, not an OTA update:

```bash
npx expo prebuild --platform ios     # regenerates Info.plist with the new key
npm run preflight                     # checks the key reached ios/Info.plist
npx expo run:ios --device <udid>      # or: npx eas build --profile production
```

`npm run preflight` fails if `ios/Info.plist` has no `GMSApiKey`, because a
binary built without it draws a map that loads for ever with no error
anywhere.

The Places key is the exception: it changes with one command and takes effect
on the next request.

---

## Telling a key problem from a build problem

The app logs this to the terminal when a map mounts:

```
[map:équipe] mounted on ios, provider=google, iosGoogleMapsApiKey=set (39 chars)
[map:équipe] onMapReady after 180ms — the SDK is running.
[map:équipe] onMapLoaded after 950ms — tiles are drawn.
```

- **`onMapReady` fires, `onMapLoaded` does not** — the SDK started and Google
  refused the tiles. A key or an API restriction.
- **Neither fires** — the SDK never started: either the key never reached the
  binary, or Google rejected it at initialisation.

> Restrictions are enforced on a **real device** and not in the simulator. One
> binary drawing a map in the simulator and nothing on a phone is the signature
> of an application restriction that does not list this bundle id. It is not a
> build problem, and rebuilding will not fix it.

The native reason is only in the device log: run from Xcode, or Console.app
with the phone selected and the filter `GMS`.
