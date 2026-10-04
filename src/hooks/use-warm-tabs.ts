import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { prefetch } from '@/hooks/use-cached';
import {
  companyKey, dashboardKey, employeesKey, liveTeamKey, loadCompany, loadDashboard,
  loadEmployees, loadPlanning, loadSites, planningKey, sitesKey,
} from '@/lib/tab-data';
import { fetchLiveTeam } from '@/lib/live-location';

/** Monday of the current week, in the plain-date form the tables store. */
function weekBounds() {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const iso = (offset: number) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + offset);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  };
  return { from: iso(0), to: iso(6) };
}

/**
 * Loads what the tabs will show as soon as the signed-in area mounts, rather
 * than when a tab is first opened. Called from the tab layout, which mounts
 * once on entering the app and stays mounted, so the work starts before the
 * first screen has even finished drawing and no tab is ever opened cold.
 *
 * Every call is a prefetch: it fills the cache and renders nothing, so a
 * failure here costs nothing beyond a tab that loads the old way.
 */
export function useWarmTabs() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const role = profile?.role;

  useEffect(() => {
    if (!companyId) return;
    const { from, to } = weekBounds();
    prefetch(planningKey(companyId, from), () => loadPlanning(companyId, from, to));
    // The chantier and employee lists are the chef's tabs; an employee has
    // neither, and their own day is owned by useWorkspace.
    if (role === 'chef') {
      prefetch(sitesKey(companyId), () => loadSites(companyId));
      prefetch(employeesKey(companyId), () => loadEmployees(companyId));
      prefetch(companyKey(companyId), () => loadCompany(companyId));
      prefetch(dashboardKey(companyId), loadDashboard);
      prefetch(liveTeamKey(companyId), fetchLiveTeam);
    }
  }, [companyId, role]);
}
