import { supabase } from '@/lib/supabase';
import type { Site } from '@/lib/presence';

/**
 * The queries behind the chef's tabs, in one place so the home screen can warm
 * exactly what those tabs will read. Keys are shared between the loader and
 * the prefetch; a key that drifts from its loader silently warms nothing, so
 * they are built here and never spelled out at the call sites.
 */

export type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  username: string | null;
  avatar_url: string | null;
};

export type Shift = {
  id: string;
  employee_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  note: string | null;
  sites: { name: string; address: string | null } | null;
  profiles: { first_name: string; last_name: string } | null;
};

export type CompanyIdentity = { name: string; join_code: string };

export const sitesKey = (companyId: string) => `sites:${companyId}`;
export const companyKey = (companyId: string) => `company:${companyId}`;
export const dashboardKey = (companyId: string) => `dashboard:${companyId}`;
export const liveTeamKey = (companyId: string) => `live-team:${companyId}`;
export const employeesKey = (companyId: string) => `employees:${companyId}`;
export const planningKey = (companyId: string, from: string) => `planning:${companyId}:${from}`;

/**
 * The company's name and the code employees type to join it.
 *
 * Both are fixed for the life of the company — the code only moves when a chef
 * deliberately regenerates it, which invalidates this key — so this is the one
 * tab read that has no business showing a spinner, ever. Cached on disk, it is
 * on screen in the first frame after a cold start.
 */
export async function loadCompany(companyId: string): Promise<CompanyIdentity> {
  const { data, error } = await supabase
    .from('companies')
    .select('name, join_code')
    .eq('id', companyId)
    .single();
  if (error) throw error;
  return data;
}

/** The chef's home screen, which is the first thing he sees after signing in
 *  and therefore the blank frame that matters most. */
export async function loadDashboard(): Promise<unknown> {
  const { data, error } = await supabase.rpc('chef_dashboard');
  if (error) throw error;
  return data;
}

export async function loadSites(companyId: string): Promise<Site[]> {
  const { data, error } = await supabase
    .from('sites')
    .select('id,name,address,is_active,latitude,longitude')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function loadEmployees(companyId: string): Promise<EmployeeRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, phone, username, avatar_url')
    .eq('company_id', companyId)
    .eq('role', 'employee')
    // Deleted accounts keep an anonymous profile row so their declared work
    // stays attributable to the company; they are not staff to list.
    .is('deleted_at', null)
    .order('first_name');
  if (error) throw error;
  return data ?? [];
}

export async function loadPlanning(companyId: string, from: string, to: string): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('planned_shifts')
    .select('id, employee_id, work_date, start_time, end_time, note, sites(name, address), profiles!planned_shifts_employee_id_fkey(first_name, last_name)')
    .eq('company_id', companyId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
    .order('start_time');
  if (error) throw error;
  return (data ?? []) as unknown as Shift[];
}
