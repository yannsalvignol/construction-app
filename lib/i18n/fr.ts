import type { Translations } from './en';

const fr = {
  common: {
    appName: 'CASPROD',
    cancel: 'Annuler',
    signOut: 'Se déconnecter',
    notSignedIn: 'Non connecté',
    done: 'Terminé',
    back: 'Retour',
  },

  planning: {
    chefHint: 'Consultation seulement : créez et envoyez les plannings depuis casprod.app.',
    employeeHint: 'Les créneaux envoyés par votre chef. Ils sont mis à jour à chaque envoi.',
    weekOf: (day: string) => `Semaine du ${day}`,
    weekTotal: (hours: number) => `${hours} h prévues cette semaine pour vous`,
    failed: 'Impossible de charger le planning. Réessayez.',
  },

  chefTabs: {
    home: 'Accueil',
    employees: 'Employés',
    sites: 'Chantiers',
    schedule: 'Planning',
    live: 'Carte',
  },

  employeeTabs: {
    today: "Aujourd'hui",
    schedule: 'Planning',
    instructions: 'Instructions',
    map: 'Présence',
    report: 'Tâches',
    account: 'Compte',
  },

  webTabBar: {
    docs: 'Documentation',
  },

  social: {
    or: 'ou',
    google: 'Continuer avec Google',
    googleBusy: 'Connexion avec Google…',
    apple: 'Continuer avec Apple',
    appleBusy: 'Connexion avec Apple…',
  },

  signIn: {
    title: 'Connexion',
    identifierPlaceholder: "E-mail ou nom d'utilisateur",
    passwordPlaceholder: 'Mot de passe',
    submit: 'Se connecter',
    submitting: 'Connexion…',
    forgotLink: 'Mot de passe oublié ?',
    registerPrompt: 'Pas encore de compte ?',
    registerAction: 'Inscrivez-vous',
  },

  forgotPassword: {
    title: 'Mot de passe oublié',
    subtitle: 'Indiquez l’e-mail de votre compte : nous vous envoyons un lien pour en choisir un nouveau.',
    emailPlaceholder: 'E-mail',
    submit: 'Envoyer le lien',
    submitting: 'Envoi…',
    sent: (email: string) => `Si un compte existe pour ${email}, un lien vient d’être envoyé.`,
    sentHint: 'Ouvrez le lien depuis ce téléphone : il vous connecte, puis changez votre mot de passe dans Compte → Sécurité.',
    employeeHint: 'Vous vous connectez avec un nom d’utilisateur ? Demandez à votre chef de réinitialiser votre mot de passe depuis votre fiche.',
    employeeError: 'Entrez une adresse e-mail. Avec un nom d’utilisateur, seul votre chef peut réinitialiser le mot de passe.',
    backLink: 'Retour à la connexion',
  },

  register: {
    chef: 'Je pilote les chantiers',
    employee: 'J’ai un code d’équipe',
    signInLink: 'Vous avez déjà un compte ? Connectez-vous',
  },

  signUp: {
    title: 'Vous êtes chef de chantier ?',
    subtitle: 'Créez le compte de votre entreprise pour commencer.',
    emailPlaceholder: 'E-mail',
    passwordPlaceholder: 'Mot de passe',
    rulePassword: 'Au moins 6 caractères',
    submit: "Créer le compte de l'entreprise",
    submitting: 'Création du compte…',
    signInLink: 'Vous avez déjà un compte ? Connectez-vous',
  },

  join: {
    title: 'Rejoindre votre équipe',
    codePlaceholder: "Code d'invitation",
    continue: 'Continuer',
    checking: 'Vérification…',
    signInLink: 'Vous avez déjà un compte ? Connectez-vous',
    joiningPrefix: 'Vous rejoignez',
    joiningSuffix: ". Choisissez un nom d'utilisateur et un mot de passe.",
    usernamePlaceholder: "Choisissez un nom d'utilisateur",
    passwordPlaceholder: 'Choisissez un mot de passe',
    createAccount: 'Créer le compte',
    creatingAccount: 'Création du compte…',
    changeCode: "Ce n'est pas la bonne entreprise ? Changer de code",
    usernamePatternError:
      "Le nom d'utilisateur doit contenir 3 à 20 caractères : lettres minuscules, chiffres, « _ » ou « . »",
    ruleLength: '3 à 20 caractères',
    ruleNoAccent: 'Ni accents, ni espaces, ni tirets',
    passwordHint: 'Au moins 6 caractères.',
    passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères.',
    rulePassword: 'Au moins 6 caractères',
    codeNotFound: 'Ce code ne correspond à aucune entreprise.',
  },

  onboarding: {
    chef: {
      title: 'Configurez votre entreprise',
      subtitle: 'Vous êtes la première personne ici, vous serez donc le chef de chantier.',
      companyNamePlaceholder: "Nom de l'entreprise",
      firstNamePlaceholder: 'Votre prénom',
      lastNamePlaceholder: 'Votre nom',
      phonePlaceholder: 'Téléphone (facultatif)',
      submit: "Créer l'entreprise",
      submitting: 'Configuration…',
    },
    employee: {
      title: 'Presque terminé',
      willSignInAs: (username: string) => `Vous vous connecterez en tant que @${username}. `,
      subtitle: 'Encore quelques informations et vous serez connecté à votre entreprise.',
      missingCodeError:
        "Nous avons perdu votre code d'invitation. Déconnectez-vous et rejoignez à nouveau depuis l'écran de connexion.",
      firstNamePlaceholder: 'Votre prénom',
      lastNamePlaceholder: 'Votre nom',
      phonePlaceholder: 'Téléphone (facultatif)',
      submit: "Rejoindre l'entreprise",
      submitting: 'Adhésion…',
    },
  },

  chefHome: {
    periods: { today: "Aujourd'hui", week: 'Semaine', month: 'Mois', year: 'Année' },
    periodPhrase: { today: "aujourd'hui", week: 'cette semaine', month: 'ce mois-ci', year: 'cette année' },
    site: 'Chantier',
    allSites: 'Tous les chantiers',
    siteFilterNote:
      "Aucun chantier pour le moment — ce filtre s'appliquera par chantier une fois les chantiers configurés.",
    stats: {
      employees: 'Employés',
      onSiteNow: 'Sur site actuellement',
      late: 'En retard',
      absent: 'Absents',
      hoursLogged: 'Heures enregistrées',
      openIssues: 'Problèmes ouverts',
    },
    onSiteNow: { title: 'Sur site actuellement', empty: 'Personne sur site pour le moment.' },
    attendance: {
      title: 'Présence',
      empty: (phrase: string) => `Aucun employé en retard ou absent ${phrase}.`,
    },
    hoursWorked: { title: 'Heures travaillées', empty: (phrase: string) => `Aucune heure enregistrée ${phrase}.` },
    recentActivity: { title: 'Activité récente', empty: (phrase: string) => `Aucune activité ${phrase}.` },
    reportedIssues: { title: 'Problèmes signalés', empty: 'Aucun problème signalé.' },
    sites: { title: 'Chantiers', empty: 'Aucun chantier pour le moment.' },
  },

  schedule: {
    title: 'Planning',
    scopes: { me: 'Mon planning', team: 'Équipe' },
    addShift: 'Ajouter un créneau',
    assignShift: 'Assigner un créneau',
    employee: 'Employé',
    allEmployees: 'Tous les employés',
    today: "Aujourd'hui",
    noShiftsToday: "Aucun créneau aujourd'hui",
    noShiftsOnDay: (dayLabel: string) => `Aucun créneau le ${dayLabel}`,
    emptyMe: "Vous n'avez aucun créneau prévu pour ce jour.",
    emptyTeam: "Rien n'est assigné à votre équipe pour ce jour pour le moment.",
    weekdayLetters: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
    months: [
      'janv.',
      'févr.',
      'mars',
      'avr.',
      'mai',
      'juin',
      'juil.',
      'août',
      'sept.',
      'oct.',
      'nov.',
      'déc.',
    ],
    weekdaysFull: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
    formatDate: (weekday: string, day: number, month: string) => `${weekday} ${day} ${month}`,
  },

  employees: {
    remove: {
      action: 'Supprimer',
      confirm: 'Supprimer définitivement cet employé ? Son compte et son accès seront effacés.',
      cancel: 'Annuler',
      hasWork: 'Impossible : cet employé a déjà déclaré du travail. Suspendez son compte depuis sa fiche.',
      failed: 'La suppression a échoué. Réessayez.',
    },
    joinCode: {
      title: "Code d'invitation de l'équipe",
      description:
        "Partagez ce code pour que les employés puissent créer leur propre compte et rejoindre automatiquement",
      copy: 'Copier le code',
      copied: 'Copié !',
      share: 'Partager',
      regenerate: 'Régénérer',
      regenerating: 'Régénération…',
      confirmMessage: 'Le code actuel cessera de fonctionner immédiatement. Continuer ?',
      shareMessage: (companyName: string, code: string) =>
        `Rejoignez ${companyName} sur Casprod : téléchargez l'application, appuyez sur « Rejoindre votre équipe avec un code », puis entrez ${code}.`,
    },
    noEmployees: 'Aucun employé pour le moment.',
    manualAddNote: 'Ou ajoutez un employé à la fois et remettez-lui ses identifiants vous-même.',
    addManually: 'Ajouter un employé manuellement',
    form: {
      ruleLength: '3 à 20 caractères',
      ruleNoAccent: 'Ni accents, ni espaces, ni tirets',
      rulePassword: 'Au moins 6 caractères',
      firstNamePlaceholder: 'Prénom',
      lastNamePlaceholder: 'Nom',
      phonePlaceholder: 'Téléphone (facultatif)',
      usernamePlaceholder: "Nom d'utilisateur",
      passwordPlaceholder: 'Mot de passe',
      credentialsTitle: 'Identifiants de connexion',
      credentialsHint:
        'Ce que l’employé saisira pour se connecter. Le bouton remplit ces deux champs au hasard.',
      generate: 'Générer',
      generateRandomly: 'Générer aléatoirement',
      submit: 'Ajouter un employé',
      submitting: 'Ajout…',
      cancel: 'Annuler',
    },
  },

  employeeDetail: {
    credentials: {
      title: 'Identifiants de connexion',
      username: "Nom d'utilisateur",
      password: 'Mot de passe',
      regenerate: 'Régénérer le mot de passe',
      regenerating: 'Génération…',
      sendToPhone: 'Envoyer les identifiants par SMS',
      sendPreview: (phone: string, username: string | null, password: string | null) =>
        `Pas encore connecté — ceci enverra un SMS au ${phone} :\nNom d'utilisateur : ${username} · Mot de passe : ${password}`,
      defaultPhone: 'son téléphone',
    },
    form: {
      firstNamePlaceholder: 'Prénom',
      lastNamePlaceholder: 'Nom',
      phonePlaceholder: 'Téléphone',
      saving: 'Enregistrement…',
      saved: 'Enregistré',
      save: 'Enregistrer les modifications',
    },
    settings: 'Paramètres',
    toggles: {
      isActive: { label: 'Actif', description: 'Désactivez pour suspendre cet employé sans le supprimer.' },
      equipmentPhoto: {
        label: "Preuve d'équipement",
        description: "Exiger une photo de l'équipement de sécurité avant de commencer un service.",
      },
      clockInPhoto: { label: 'Photo de pointage', description: 'Exiger une photo lors du pointage.' },
      notifications: {
        label: 'Notifications',
        description: 'Recevoir les instructions et alertes du chef.',
      },
      liveLocation: {
        label: 'Localisation en direct',
        description:
          'Suivre cet employé sur la carte pendant ses journées déclarées. Sinon, sa position n’est relevée qu’aux vérifications ponctuelles. L’employé doit donner son accord dans l’app.',
      },
    },
  },

  employeeHome: {
    title: "Aujourd'hui",
    subtitle: 'Pointez, consultez votre planning et votre chantier assigné.',
  },

  instructions: {
    title: 'Instructions',
    subtitle: 'Messages de votre chef de chantier.',
  },

  report: {
    title: 'Signaler',
    subtitle: 'Signalez un problème et envoyez des photos.',
  },

  settings: {
    title: 'Réglages',
    appearance: {
      title: 'Apparence',
      light: 'Clair',
      dark: 'Sombre',
      system: 'Système',
    },
  },

  account: {
    role: { chef: 'Chef', employee: 'Employé' },
    changePhoto: 'Changer la photo',
    uploadingPhoto: 'Envoi…',
    photoPermissionDenied: "L'accès à la photothèque a été refusé",
    profile: {
      title: 'Profil',
      firstNamePlaceholder: 'Prénom',
      lastNamePlaceholder: 'Nom',
      phonePlaceholder: 'Téléphone',
      companyNamePlaceholder: "Nom de l'entreprise",
      saving: 'Enregistrement…',
      saved: 'Enregistré',
      save: 'Enregistrer les modifications',
    },
    security: {
      title: 'Sécurité',
      changePassword: 'Changer le mot de passe',
      newPasswordPlaceholder: 'Nouveau mot de passe',
      confirmPasswordPlaceholder: 'Confirmer le nouveau mot de passe',
      passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères',
      passwordsDoNotMatch: 'Les mots de passe ne correspondent pas',
      updating: 'Mise à jour…',
      updated: 'Mis à jour',
      update: 'Mettre à jour le mot de passe',
      socialOnly: (provider: string) =>
        `Vous vous connectez avec ${provider} : ce compte n'a pas de mot de passe. Gérez-le depuis votre compte ${provider}.`,
    },
    language: {
      title: 'Langue',
      french: 'Français',
      english: 'English',
    },
    about: {
      title: 'À propos',
      version: 'Version',
      privacyPolicy: 'Politique de confidentialité',
      termsOfService: "Conditions d'utilisation",
      notAvailableYet: 'Pas encore disponible.',
    },
    deletion: {
      title: 'Supprimer le compte',
      action: 'Supprimer mon compte',
      employeeWarning:
        'Votre identifiant, votre nom, votre téléphone, votre photo ainsi que vos photos et positions de présence sont effacés définitivement. Le travail déjà déclaré sous votre nom reste dans les registres de l’entreprise, sans votre identité.',
      chefWarning:
        'Vous êtes le seul chef de cette entreprise. Supprimer votre compte supprime l’entreprise : ses chantiers, toutes les déclarations et vérifications de présence, et les comptes de tous les employés. Cette action est irréversible.',
      confirm: 'Supprimer définitivement',
      deleting: 'Suppression…',
      failed: 'La suppression a échoué. Vérifiez votre connexion et réessayez.',
    },
    signedInAs: (role: string) => `Connecté en tant que ${role}`,
  },
} satisfies Translations;

export default fr;
