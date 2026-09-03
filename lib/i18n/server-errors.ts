import type { Locale } from './locale';

/**
 * Errors thrown by Postgres RPCs (raise exception) and the Edge Functions
 * come back as plain English text — there's no error-code layer between the
 * database/Deno functions and the client, and adding one would mean touching
 * every migration and function just for this. Instead, known messages (all
 * literal strings this codebase itself raises — see the migrations under
 * supabase/migrations and supabase/functions/*) are matched verbatim and
 * translated here. An unrecognized message (a raw Postgres constraint error,
 * a GoTrue/Supabase Auth message like "User already registered") falls back
 * to the original English text rather than showing nothing.
 */
const FRENCH_SERVER_ERRORS: Record<string, string> = {
  'A profile already exists for this user': 'Un profil existe déjà pour cet utilisateur.',
  'Username must be 3-20 characters: lowercase letters, numbers, "_" or "."':
    "Le nom d'utilisateur doit contenir 3 à 20 caractères : lettres minuscules, chiffres, « _ » ou « . ».",
  'This account is not set up for employee sign-in':
    "Ce compte n'est pas configuré pour une connexion employé.",
  "That code doesn't match any company. Double-check it with your chef.":
    'Ce code ne correspond à aucune entreprise. Vérifiez-le avec votre chef.',
  'That username is already taken': "Ce nom d'utilisateur est déjà pris.",
  'Only a chef can regenerate the join code': "Seul un chef peut régénérer le code d'invitation.",
  'Could not generate a unique join code': "Impossible de générer un code d'invitation unique.",
  'Missing authorization header': "En-tête d'autorisation manquant.",
  'Not authenticated': 'Non authentifié.',
  'Profile not found': 'Profil introuvable.',
  'Only a chef can create employees': 'Seul un chef peut créer des employés.',
  'Missing required fields': 'Champs requis manquants.',
  'Password must be at least 6 characters': 'Le mot de passe doit contenir au moins 6 caractères.',
  'Only a chef can reset an employee password':
    "Seul un chef peut réinitialiser le mot de passe d'un employé.",
  'Employee not found': 'Employé introuvable.',
  'Not authorized to reset this employee': 'Non autorisé à réinitialiser cet employé.',
  'Could not create employee account': 'Impossible de créer le compte employé.',
};

export function translateServerError(message: string, locale: Locale): string {
  if (locale === 'en') return message;
  return FRENCH_SERVER_ERRORS[message] ?? message;
}
