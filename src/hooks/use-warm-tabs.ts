import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { Image } from 'expo-image';

import { useAuth } from '@/hooks/use-auth';
import { prefetch } from '@/hooks/use-cached';
import { fetchLiveTeam } from '@/lib/live-location';
import {
  companyKey, dashboardKey, employeesKey, liveTeamKey, loadCompany, loadDashboard,
  loadEmployees, loadPlanning, loadSites, planningKey, sitesKey,
} from '@/lib/tab-data';

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
 * The screens whose JavaScript is worth evaluating before anybody asks for it.
 *
 * A route's module is only required the first time it is navigated to, and
 * Employés is the largest of them — forms, the phone field, the swipe rows,
 * the credential rules — so the first press paid for parsing and running all
 * of it before a single pixel moved. Warming the data had made that the only
 * delay left, and therefore the obvious one.
 *
 * Metro needs the path spelled out at the call site, so these are written
 * literally rather than built from the tab names.
 */
const CHEF_SCREENS = [
  () => import('@/app/(app)/(chef)/employees/index'),
  () => import('@/app/(app)/(chef)/employees/[id]'),
  () => import('@/app/(app)/(chef)/sites'),
  () => import('@/app/(app)/(chef)/live'),
];

const EMPLOYEE_SCREENS = [
  () => import('@/app/(app)/(employee)/instructions'),
  () => import('@/app/(app)/(employee)/report'),
  () => import('@/app/(app)/(employee)/account'),
];

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
    void prefetch(planningKey(companyId, from), () => loadPlanning(companyId, from, to));
    // The chantier and employee lists are the chef's tabs; an employee has
    // neither, and their own day is owned by useWorkspace.
    if (role === 'chef') {
      void prefetch(sitesKey(companyId), () => loadSites(companyId));
      void prefetch(companyKey(companyId), () => loadCompany(companyId));
      void prefetch(dashboardKey(companyId), loadDashboard);
      void prefetch(liveTeamKey(companyId), fetchLiveTeam);
      // The faces too. Without this the list arrives instantly and then fills
      // in one avatar at a time, which looks worse than waiting for all of it.
      void prefetch(employeesKey(companyId), () => loadEmployees(companyId)).then((rows) => {
        const faces = (rows ?? []).map((row) => row.avatar_url).filter((url): url is string => !!url);
        if (faces.length) void Image.prefetch(faces).catch(() => {});
      });
    }
  }, [companyId, role]);

  useEffect(() => {
    if (!role) return;
    // After the screen the chef is actually looking at has settled: this is
    // several hundred kilobytes of module evaluation, and doing it during the
    // first paint would move the delay rather than remove it.
    const task = InteractionManager.runAfterInteractions(() => {
      for (const open of role === 'chef' ? CHEF_SCREENS : EMPLOYEE_SCREENS) {
        void open().catch(() => {});
      }
    });
    return () => task.cancel();
  }, [role]);
}
