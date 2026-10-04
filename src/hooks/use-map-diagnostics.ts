import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Why a map is blank, said in the terminal running the app.
 *
 * The Google Maps SDK reports its failures natively — a bad key, an API that
 * is not enabled, a bundle id the key does not allow — and none of that
 * reaches Metro. What does reach it is whether the map ever became ready, and
 * that alone separates the two cases worth telling apart:
 *
 *   ready fires, loaded does not  → the SDK started and the tiles were
 *                                   refused: a key or restriction problem.
 *   ready never fires             → the SDK never started at all: on iOS that
 *                                   is a missing GMSApiKey in Info.plist,
 *                                   which means the native project was built
 *                                   before the key was configured.
 *
 * Never logs the key itself. A Maps key is readable in the binary by anyone
 * who wants it, which is why it is protected by restrictions rather than by
 * secrecy — but a terminal is pasted into messages, and that is a different
 * exposure.
 */
const GIVE_UP_MS = 8000;

export function useMapDiagnostics(name: string) {
  // Stamped in an effect, not during render: the compiler is right that
  // Date.now() in a render body is a lie about when the render happened.
  const mounted = useRef(0);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    mounted.current = Date.now();
    const plugins = (Constants.expoConfig?.plugins ?? []) as unknown[];
    const maps = plugins.find(
      (p) => Array.isArray(p) && p[0] === 'react-native-maps'
    ) as [string, Record<string, unknown>] | undefined;
    const args = maps?.[1] ?? {};
    const keyFor = Platform.OS === 'ios' ? 'iosGoogleMapsApiKey' : 'androidGoogleMapsApiKey';
    const key = args[keyFor];

    console.log(
      `[map:${name}] mounted on ${Platform.OS}, provider=google, ` +
        `${keyFor}=${typeof key === 'string' && key.length ? `set (${key.length} chars)` : 'MISSING'}`
    );

    const timer = setTimeout(() => {
      if (readyRef.current) return;
      console.warn(
        `[map:${name}] still not ready after ${GIVE_UP_MS / 1000}s — the Google Maps SDK never started.\n` +
          '  Two causes, and they need different fixes:\n' +
          '  1. The key never reached the binary. Check it, do not assume:\n' +
          '       /usr/libexec/PlistBuddy -c "Print :GMSApiKey" ios/*/Info.plist\n' +
          '     Absent means this binary predates the key. Rebuild natively; a JS\n' +
          '     reload cannot help, since the SDK is linked into the binary.\n' +
          '  2. The key is there and Google refused it at startup — wrong key, the\n' +
          '     SDK not enabled on the project, or an application restriction that\n' +
          '     does not allow this bundle id. Restrictions are enforced on a real\n' +
          '     device and not in the simulator, which is why a map can work in one\n' +
          '     and not the other from the same binary.\n' +
          '  The native reason is only in the device log: run from Xcode, or use\n' +
          '  Console.app with the phone selected and the filter GMS.'
      );
    }, GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [name]);

  return {
    onMapReady: () => {
      readyRef.current = true;
      setReady(true);
      console.log(`[map:${name}] onMapReady after ${Date.now() - mounted.current}ms — the SDK is running.`);
    },
    onMapLoaded: () => {
      console.log(
        `[map:${name}] onMapLoaded after ${Date.now() - mounted.current}ms — tiles are drawn.`
      );
    },
    // Ready without tiles is the shape of a refused key: the SDK started, and
    // Google declined to serve it.
    ready,
  };
}
