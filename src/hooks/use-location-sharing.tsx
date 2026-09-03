import * as Location from 'expo-location';
import { createContext, useContext, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

const UPDATE_INTERVAL_MS = 30000;

export type LocationSharingStatus = 'idle' | 'starting' | 'active' | 'denied' | 'error';

const LocationSharingContext = createContext<LocationSharingStatus>('idle');

/**
 * While the signed-in employee has location tracking enabled (a chef-controlled
 * toggle) and the app is in the foreground, reports their coordinates to
 * update_own_employee_location() roughly every 30s. Stops automatically when
 * the toggle is off, the app backgrounds (watchPositionAsync simply stops
 * delivering callbacks — JS is suspended), or the user signs out.
 */
function useLocationSharingWatcher(): LocationSharingStatus {
  const { profile } = useAuth();
  const [status, setStatus] = useState<LocationSharingStatus>('idle');

  const enabled = profile?.role === 'employee' && profile.location_tracking_enabled;

  useEffect(() => {
    if (!enabled) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    async function report(coords: Location.LocationObjectCoords) {
      const { error } = await supabase.rpc('update_own_employee_location', {
        lat: coords.latitude,
        lng: coords.longitude,
      });
      if (cancelled) return;
      if (error) {
        console.error('[location-sharing] failed to report position', error);
        setStatus('error');
      } else {
        setStatus('active');
      }
    }

    async function start() {
      setStatus('starting');

      const { status: permissionStatus } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;

      if (permissionStatus !== 'granted') {
        setStatus('denied');
        return;
      }

      // Push one fix straight away. watchPositionAsync only fires when the device
      // decides something changed, so a stationary employee could otherwise sit
      // there for minutes without ever appearing on their chef's map.
      try {
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        await report(initial.coords);
      } catch (error) {
        console.warn('[location-sharing] could not get an initial fix', error);
      }
      if (cancelled) return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: UPDATE_INTERVAL_MS,
          distanceInterval: 0,
        },
        (location) => {
          report(location.coords);
        }
      );

      if (cancelled) {
        subscription.remove();
      }
    }

    start();

    return () => {
      cancelled = true;
      subscription?.remove();
      setStatus('idle');
    };
  }, [enabled]);

  return enabled ? status : 'idle';
}

export function LocationSharingProvider({ children }: { children: React.ReactNode }) {
  const status = useLocationSharingWatcher();
  return (
    <LocationSharingContext.Provider value={status}>{children}</LocationSharingContext.Provider>
  );
}

/** Read-only view of the sharing watcher, for screens that explain the current state. */
export function useLocationSharingStatus() {
  return useContext(LocationSharingContext);
}
