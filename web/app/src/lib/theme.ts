import { useEffect, useState } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'system';
const KEY = 'casprod-theme';

export function readChoice(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage blocked */ }
  return 'dark';
}
function resolve(choice: ThemeChoice): 'dark' | 'light' {
  if (choice !== 'system') return choice;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = resolve(choice);
}

/** Persisted theme choice; the same resolution runs inline in index.html before first paint. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  useEffect(() => {
    applyTheme(choice);
    try { localStorage.setItem(KEY, choice); } catch { /* storage blocked */ }
    if (choice !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);
  return [choice, setChoice] as const;
}
