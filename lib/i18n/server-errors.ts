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
  'Invalid work duration': 'Durée de journée invalide.',
  'A photo of your safety equipment is required to start the day':
    "Votre chef demande une photo de votre équipement de sécurité avant de commencer la journée.",
  'A clock-in photo is required to start the day':
    'Votre chef demande une photo de pointage avant de commencer la journée.',
  'Only a chef can validate a devis': 'Seul un chef peut valider un devis.',
  'This devis has not been read yet': "Ce devis n'a pas encore été lu.",
  'That devis does not belong to this chantier': 'Ce devis n’appartient pas à ce chantier.',
  'A devis cannot replace itself': 'Un devis ne peut pas se remplacer lui-même.',
  'Work has already been declared against that devis; add an avenant instead':
    'Du travail a déjà été déclaré sur ce devis : il ne peut plus être remplacé. Ajoutez un avenant à la place.',
  // Handing out devis work, and striking lines off it.
  'Only a chef can hand out work': 'Seul un chef peut attribuer du travail.',
  'Say whether the work is theirs': "Précisez si la tâche lui est attribuée.",
  'Name a line or an operation, not both': 'Désignez une ligne ou une opération, pas les deux.',
  'That employee is not in your company': "Cet employé n'appartient pas à votre entreprise.",
  'That account is closed': 'Ce compte est clôturé.',
  'That task does not belong to your company': "Cette tâche n'appartient pas à votre entreprise.",
  'Only a chef can delete an operation': 'Seul un chef peut supprimer une opération.',
  'That operation does not exist': "Cette opération n'existe pas.",
  'That operation is already done; it cannot be deleted':
    'Cette opération est déjà faite : elle ne peut pas être supprimée.',
  'Only a chef can delete a line': 'Seul un chef peut supprimer une ligne.',
  'Only a chef can delete a devis': 'Seul un chef peut supprimer un devis.',
  'Work has already been declared against that devis':
    'Du travail a déjà été déclaré sur ce devis : il ne peut plus être supprimé. Importez le devis qui le remplace, ce qui garde ce qui a été déclaré.',
  'Quote not found': 'Ce devis est introuvable dans votre entreprise.',
  'That line does not exist': "Cette ligne n'existe pas.",
  'Work has already been declared on that line':
    'Du travail a déjà été déclaré sur cette ligne : mettez sa quantité à zéro plutôt que de la supprimer.',
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
  // Supabase Auth (GoTrue) speaks for itself and never went through this table,
  // so its messages reached users in raw English on the screens that matter most.
  'User already registered': 'Un compte existe déjà avec cette adresse e-mail.',
  'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
  'Unable to validate email address: invalid format':
    "Cette adresse e-mail n'est pas valide. Vérifiez le format, par exemple nom@entreprise.com.",
  'Signup requires a valid password': 'Un mot de passe est requis pour créer le compte.',
  'Password should be at least 6 characters.':
    'Le mot de passe doit contenir au moins 6 caractères.',
  'Email rate limit exceeded':
    'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  'Email not confirmed': "Cette adresse e-mail n'a pas encore été confirmée.",
  // Rules added with presence, live location and located sites.
  'Chef account required': 'Cette action est réservée aux chefs de chantier.',
  'Employee account required': 'Cette action est réservée aux comptes employés actifs.',
  'Site not found': 'Ce chantier est introuvable dans votre entreprise.',
  'Chef account required.': 'Cette action est réservée aux chefs de chantier.',
  'Only an employee can be removed': 'Seul un compte employé peut être supprimé.',
  'This employee has declared work. Suspend the account instead.':
    'Cet employé a déjà déclaré du travail : son historique appartient à l’entreprise. Suspendez son compte depuis sa fiche.',
  'A site needs an address recognised by the map':
    'Le chantier a besoin d’une adresse reconnue par la carte. Placez le repère sur le chantier.',
  'Live location is not enabled for this account':
    'Le partage en direct n’est pas activé pour ce compte.',
  'Live location information and explicit agreement required':
    'Votre accord est nécessaire avant de partager votre position.',
  'Please read the current live location notice':
    'Veuillez lire la version actuelle de la notice de localisation.',
  'Presence information and explicit agreement required':
    'Votre accord est nécessaire avant les vérifications de présence.',
  'Please read the current presence notice':
    'Veuillez lire la version actuelle de la notice de présence.',
  'Start a work day before declaring tasks':
    'Commencez votre journée avant de déclarer des tâches.',
  'Start a work day before sharing your location':
    'Commencez votre journée avant de partager votre position.',
  'Only an open work day can be cancelled': 'Seule une journée en cours peut être annulée.',
  'Tasks were declared on this day. Finish it instead.':
    'Des tâches ont été déclarées sur cette journée : terminez-la au lieu de l’annuler.',
  'A presence check was answered on this day. Finish it instead.':
    'Une vérification de présence a été validée sur cette journée : terminez-la au lieu de l’annuler.',
  'Work day not found': 'Journée introuvable.',
  'Finish your current work day first': 'Terminez votre journée en cours avant d’en commencer une autre.',
  'Choose an active site in your company':
    'Choisissez un chantier actif de votre entreprise.',
  'Choose a task from the catalogue': 'Choisissez une tâche dans le catalogue.',
  'Enter a valid quantity': 'Saisissez une quantité valide.',
  'Enter a whole number of units': 'Saisissez un nombre entier d’unités.',
  'Request timed out':
    'Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.',
};

const FRENCH_SERVER_PATTERNS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^For security purposes, you can only request this after (\d+) seconds?/i,
    m => `Pour des raisons de sécurité, réessayez dans ${m[1]} secondes.`],
  [/^Password should be at least (\d+) characters/i,
    m => `Le mot de passe doit contenir au moins ${m[1]} caractères.`],
];

export function translateServerError(message: string, locale: Locale): string {
  if (locale === 'en') return message;
  const known = FRENCH_SERVER_ERRORS[message];
  if (known) return known;
  for (const [pattern, build] of FRENCH_SERVER_PATTERNS) {
    const match = message.match(pattern);
    if (match) return build(match);
  }
  return message;
}
