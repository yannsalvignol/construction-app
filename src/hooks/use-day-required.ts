import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { router, useIsFocused } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useWorkspace } from '@/hooks/use-workspace';

/**
 * The tabs that only mean something once a day has been declared.
 *
 * "Mes tâches" and "Instructions" used to open on a sentence explaining that
 * a day has to be started first — an answer in the wrong place, since the
 * button that starts one is on another tab. A worker reads the sentence, and
 * still has to work out where to go.
 *
 * So they do not open at all. The tab bounces back to the day, and the button
 * he needs lights up as he lands on it. Nothing is hidden: the tabs stay
 * visible, because a tab that disappears teaches nothing about what to do to
 * get it back.
 */

let nudges = 0;
const listeners = new Set<() => void>();

/** Asks the day screen to point at its own start button. */
export function nudgeStartDay() {
  nudges += 1;
  for (const listener of listeners) listener();
}

/** A counter, not a flag: every refusal lights the button again, because a
 *  second tap that changes nothing reads as the app having stopped listening. */
export function useStartDayNudge() {
  return useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }, []),
    () => nudges,
    () => nudges
  );
}

/**
 * Sends the worker back to his day when he has not started one.
 *
 * Waits for the workspace to load first: bouncing on an unanswered request
 * would throw him off a tab he is entitled to every time the signal drops.
 */
export function useDayRequired() {
  const { data, loading, now } = useWorkspace({ manageSharing: false });
  const active = !!data?.day && !data.day.ended_at && Date.parse(data.day.planned_end_at) > now;
  // A value rather than a ref: these tabs stay mounted behind the one on
  // screen, and a ref read inside an effect would not re-run when focus
  // arrives. Only the tab actually on top may send anybody anywhere.
  const focused = useIsFocused();

  useEffect(() => {
    if (loading || active || !data || !focused) return;
    nudgeStartDay();
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    router.replace('/(app)/(employee)');
  }, [loading, active, data, focused]);

  return active;
}
