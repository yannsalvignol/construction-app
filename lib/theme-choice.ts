import { Appearance } from 'react-native';

import './sqlite-local-storage';

/**
 * Light / dark override chosen in Réglages, or follow the OS. Mirrors the
 * web app's `casprod-theme` choice. Applied through Appearance.setColorScheme
 * so every useColorScheme() consumer follows without a context.
 *
 * Light until somebody says otherwise, rather than whatever the phone is set
 * to. A chantier is read outdoors, where a dark screen in sunlight is the
 * harder of the two to make out — and a phone left on dark because of a
 * film watched the night before is not a decision about this app. Dark is
 * one tap away in Réglages for whoever wants it.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'casprod:theme';

export function readStoredThemeChoice(): ThemeChoice {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch { /* storage unavailable */ }
  return 'light';
}

export function applyThemeChoice(choice: ThemeChoice) {
  // react-native-web's Appearance has no setter; the web build follows the OS.
  if (typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice);
}

export function saveThemeChoice(choice: ThemeChoice) {
  applyThemeChoice(choice);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, choice);
  } catch { /* storage unavailable */ }
}
