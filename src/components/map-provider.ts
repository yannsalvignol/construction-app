import { Platform } from 'react-native';
import { PROVIDER_GOOGLE } from 'react-native-maps';

/**
 * Who draws the map.
 *
 * Android: Google. iOS: Apple, for now.
 *
 * iOS was meant to use Google too, because Apple and Google do not draw
 * Morocco the same way and an app used by Moroccan crews should show the
 * country as its users understand it. It worked in the simulator and never on
 * a real device, through a correct key, a correct binary, and an SDK that
 * initialises — and the one thing that would say why, the native log from the
 * phone, could not be got at. Rather than keep a map that is blank on every
 * iPhone, iOS falls back to Apple until that message exists.
 *
 * The Google key stays wired into the iOS build on purpose. Nothing uses it
 * while this returns undefined, and because the provider is a JS prop, going
 * back to Google is a one-line change that can ship over the air rather than
 * through a native build and a review.
 */
export const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;
