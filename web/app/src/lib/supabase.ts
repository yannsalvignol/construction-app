import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required (see .env.example)');

export const supabase = createClient(url, key);

/** Employees sign in with a username; it maps to a synthetic address, as in the mobile app. */
export const EMPLOYEE_EMAIL_DOMAIN = 'employee.local';
export function toAuthEmail(identifier: string) {
  const trimmed = identifier.trim();
  return trimmed.includes('@') ? trimmed : `${trimmed.toLowerCase()}@${EMPLOYEE_EMAIL_DOMAIN}`;
}

/** Known server messages (raised verbatim by the SQL functions and Edge Functions). */
const FR: Record<string, string> = {
  'Invalid login credentials': 'Identifiant ou mot de passe incorrect.',
  'User already registered': 'Un compte existe déjà avec cette adresse.',
  'A profile already exists for this user': 'Un profil existe déjà pour cet utilisateur.',
  'Only a chef can create employees': 'Seul un chef peut créer des employés.',
  'That username is already taken': "Ce nom d'utilisateur est déjà pris.",
  'Username must be 3-20 characters: lowercase letters, numbers, "_" or "."': "Le nom d'utilisateur doit contenir 3 à 20 caractères : lettres minuscules, chiffres, « _ » ou « . ».",
  'Password must be at least 6 characters': 'Le mot de passe doit contenir au moins 6 caractères.',
  'This employee has declared work. Suspend the account instead.': 'Cet employé a déjà déclaré du travail. Suspendez son compte à la place.',
  'Chef account required': 'Compte chef requis.',
  'Employee not found': 'Employé introuvable.',
  'Site not found': 'Chantier introuvable.',
  'Only a chef can regenerate the join code': "Seul un chef peut régénérer le code d'affiliation.",
  'Nothing to send for this period': 'Rien à envoyer pour cette période.',
  'Invalid date range': 'Période invalide.',
};
export function fr(message: string | undefined | null, fallback = 'Une erreur est survenue. Réessayez.') {
  if (!message) return fallback;
  return FR[message] ?? message;
}

/** Edge Functions put the real reason in the response body on non-2xx. */
export async function functionError(error: unknown): Promise<string> {
  const e = error as { context?: Response; message?: string } | null;
  try {
    const body = await e?.context?.json();
    if (body?.error) return fr(body.error);
  } catch { /* not JSON */ }
  return fr(e?.message);
}
