import 'expo-sqlite/localStorage/install';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import en from '@/lib/i18n/en';
import type { Translations } from '@/lib/i18n/en';
import fr from '@/lib/i18n/fr';
import type { Locale } from '@/lib/i18n/locale';

const STORAGE_KEY = 'casprod:locale';
const DEFAULT_LOCALE: Locale = 'fr';

const dictionaries: Record<Locale, Translations> = { fr, en };

function isLocale(value: string | null): value is Locale {
  return value === 'fr' || value === 'en';
}

function readStoredLocale(): Locale {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_LOCALE;
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

type I18nContextValue = {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Defaults to French rather than the device's own locale — a deliberate
 * product choice, not a detection gap — and persists whatever the user picks
 * in Account settings so it survives app restarts and sign-out/sign-in.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      console.error('[i18n] failed to persist locale', error);
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: dictionaries[locale], setLocale }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within an I18nProvider');
  return context;
}
