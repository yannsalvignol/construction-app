/**
 * Canonical English dictionary — defines the shape every other language must
 * match (see fr.ts's `satisfies Translations`). Organized by screen/component
 * so a given file's strings live together and are easy to find.
 */
const en = {
  common: {
    appName: 'CASPROD',
    cancel: 'Cancel',
    signOut: 'Sign out',
    notSignedIn: 'Not signed in',
    done: 'Done',
    back: 'Back',
  },

  planning: {
    chefHint: 'Read-only here: create and send plannings from casprod.app.',
    employeeHint: 'The shifts your chef sent you. Updated on every send.',
    weekOf: (day: string) => `Week of ${day}`,
    weekTotal: (hours: number) => `${hours} h planned for you this week`,
    failed: 'Could not load the planning. Try again.',
  },

  chefTabs: {
    home: 'Home',
    employees: 'Employees',
    sites: 'Sites',
    schedule: 'Schedule',
    live: 'Live',
  },

  employeeTabs: {
    today: 'Today',
    schedule: 'Planning',
    instructions: 'Instructions',
    map: 'Presence',
    report: 'Tasks',
    account: 'Account',
  },

  webTabBar: {
    docs: 'Docs',
  },

  social: {
    or: 'or',
    google: 'Continue with Google',
    googleBusy: 'Signing in with Google…',
    apple: 'Continue with Apple',
    appleBusy: 'Signing in with Apple…',
  },

  signIn: {
    title: 'Sign in',
    identifierPlaceholder: 'Email or username',
    passwordPlaceholder: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    ownerLink: "You're the owner? Sign up",
    joinLink: 'New here? Join your team with a code',
  },

  signUp: {
    title: "You're the owner?",
    subtitle: 'Create your company account to get started.',
    emailPlaceholder: 'Email',
    passwordPlaceholder: 'Password',
    rulePassword: 'At least 6 characters',
    submit: 'Create company account',
    submitting: 'Creating account…',
    signInLink: 'Already have an account? Sign in',
  },

  join: {
    title: 'Join your team',
    codeSubtitle: "Ask your chef for your company's join code.",
    codePlaceholder: 'Join code',
    continue: 'Continue',
    checking: 'Checking…',
    signInLink: 'Already have an account? Sign in',
    joiningPrefix: "You're joining",
    joiningSuffix: '. Pick a username and password.',
    usernamePlaceholder: 'Choose a username',
    passwordPlaceholder: 'Choose a password',
    createAccount: 'Create account',
    creatingAccount: 'Creating account…',
    changeCode: 'Not the right company? Change code',
    usernamePatternError: 'Username must be 3-20 characters: lowercase letters, numbers, "_" or "."',
    ruleLength: '3 to 20 characters',
    ruleNoAccent: 'No accents, spaces or hyphens',
    passwordHint: 'At least 6 characters.',
    passwordTooShort: 'The password must be at least 6 characters.',
    rulePassword: 'At least 6 characters',
    codeNotFound: "That code doesn't match any company.",
  },

  onboarding: {
    chef: {
      title: 'Set up your company',
      subtitle: "You're the first person here, so you'll be the chef de chantier.",
      companyNamePlaceholder: 'Company name',
      firstNamePlaceholder: 'Your first name',
      lastNamePlaceholder: 'Your last name',
      phonePlaceholder: 'Phone (optional)',
      submit: 'Create company',
      submitting: 'Setting up…',
    },
    employee: {
      title: 'Almost there',
      willSignInAs: (username: string) => `You'll sign in as @${username}. `,
      subtitle: "Just a few details and you'll be connected to your company.",
      missingCodeError: 'We lost track of your join code. Sign out and join again from the sign-in screen.',
      firstNamePlaceholder: 'Your first name',
      lastNamePlaceholder: 'Your last name',
      phonePlaceholder: 'Phone (optional)',
      submit: 'Join company',
      submitting: 'Joining…',
    },
  },

  chefHome: {
    periods: { today: 'Today', week: 'Week', month: 'Month', year: 'Year' },
    periodPhrase: { today: 'today', week: 'this week', month: 'this month', year: 'this year' },
    site: 'Site',
    allSites: 'All sites',
    siteFilterNote: 'No sites yet — this will filter by construction site once sites are set up.',
    stats: {
      employees: 'Employees',
      onSiteNow: 'On site now',
      late: 'Late',
      absent: 'Absent',
      hoursLogged: 'Hours logged',
      openIssues: 'Open issues',
    },
    onSiteNow: { title: 'On site now', empty: 'No one is on site right now.' },
    attendance: { title: 'Attendance', empty: (phrase: string) => `No late or absent employees ${phrase}.` },
    hoursWorked: { title: 'Hours worked', empty: (phrase: string) => `No hours logged ${phrase}.` },
    recentActivity: { title: 'Recent activity', empty: (phrase: string) => `No activity ${phrase}.` },
    reportedIssues: { title: 'Reported issues', empty: 'No issues reported.' },
    sites: { title: 'Sites', empty: 'No sites yet.' },
  },

  schedule: {
    title: 'Schedule',
    scopes: { me: 'My schedule', team: 'Team' },
    addShift: 'Add shift',
    assignShift: 'Assign shift',
    employee: 'Employee',
    allEmployees: 'All employees',
    today: 'Today',
    noShiftsToday: 'No shifts today',
    noShiftsOnDay: (dayLabel: string) => `No shifts on ${dayLabel}`,
    emptyMe: "You don't have any shifts scheduled for this day.",
    emptyTeam: 'Nothing assigned to your team for this day yet.',
    weekdayLetters: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    months: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    weekdaysFull: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ],
    formatDate: (weekday: string, day: number, month: string) => `${weekday}, ${month} ${day}`,
  },

  employees: {
    remove: {
      action: 'Delete',
      confirm: 'Delete this employee for good? Their account and access are erased.',
      cancel: 'Cancel',
      hasWork: 'Not possible: this employee has already declared work. Suspend the account from their page instead.',
      failed: 'Deleting failed. Please try again.',
    },
    joinCode: {
      title: 'Team join code',
      description:
        'Share this code so employees can create their own account and join automatically — no need to add each one by hand.',
      copy: 'Copy code',
      copied: 'Copied!',
      share: 'Share',
      regenerate: 'Regenerate',
      regenerating: 'Regenerating…',
      confirmMessage: 'The current code will stop working immediately. Continue?',
      shareMessage: (companyName: string, code: string) =>
        `Join ${companyName} on Casprod: download the app, tap "Join your team with a code", and enter ${code}.`,
    },
    noEmployees: 'No employees yet.',
    manualAddNote: 'Or add one employee at a time and hand them their login yourself.',
    addManually: 'Add employee manually',
    form: {
      ruleLength: '3 to 20 characters',
      ruleNoAccent: 'No accents, spaces or hyphens',
      rulePassword: 'At least 6 characters',
      firstNamePlaceholder: 'First name',
      lastNamePlaceholder: 'Last name',
      phonePlaceholder: 'Phone (optional)',
      usernamePlaceholder: 'Username',
      passwordPlaceholder: 'Password',
      credentialsTitle: 'Sign-in credentials',
      credentialsHint:
        'What the employee will type to sign in. The button fills these two fields at random.',
      generate: 'Generate',
      generateRandomly: 'Generate randomly',
      submit: 'Add employee',
      submitting: 'Adding…',
      cancel: 'Cancel',
    },
  },

  employeeDetail: {
    credentials: {
      title: 'Login credentials',
      username: 'Username',
      password: 'Password',
      regenerate: 'Regenerate password',
      regenerating: 'Generating…',
      sendToPhone: 'Send login info to phone',
      sendPreview: (phone: string, username: string | null, password: string | null) =>
        `Not connected yet — this will text ${phone}:\nUsername: ${username} · Password: ${password}`,
      defaultPhone: 'their phone',
    },
    form: {
      firstNamePlaceholder: 'First name',
      lastNamePlaceholder: 'Last name',
      phonePlaceholder: 'Phone',
      saving: 'Saving…',
      saved: 'Saved',
      save: 'Save changes',
    },
    settings: 'Settings',
    toggles: {
      isActive: { label: 'Active', description: 'Turn off to suspend this employee without deleting them.' },
      equipmentPhoto: {
        label: 'Proof of equipment',
        description: 'Require a photo of safety equipment before starting a shift.',
      },
      clockInPhoto: { label: 'Clock-in photo', description: 'Require a photo when clocking in.' },
      notifications: {
        label: 'Notifications',
        description: 'Receive instructions and alerts from the chef.',
      },
      liveLocation: {
        label: 'Live location',
        description:
          'Follow this employee on the map during declared work days. Otherwise their position is only captured at occasional checks. The employee must agree in the app.',
      },
    },
  },

  employeeHome: {
    title: 'Today',
    subtitle: 'Clock in, see your schedule, and your assigned site.',
  },

  instructions: {
    title: 'Instructions',
    subtitle: 'Messages from your chef de chantier.',
  },

  report: {
    title: 'Report',
    subtitle: 'Report an issue and upload photos.',
  },

  settings: {
    title: 'Settings',
    appearance: {
      title: 'Appearance',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    },
  },

  account: {
    role: { chef: 'Chef', employee: 'Employee' },
    changePhoto: 'Change photo',
    uploadingPhoto: 'Uploading…',
    photoPermissionDenied: 'Photo library access was denied',
    profile: {
      title: 'Profile',
      firstNamePlaceholder: 'First name',
      lastNamePlaceholder: 'Last name',
      phonePlaceholder: 'Phone',
      companyNamePlaceholder: 'Company name',
      saving: 'Saving…',
      saved: 'Saved',
      save: 'Save changes',
    },
    security: {
      title: 'Security',
      changePassword: 'Change password',
      newPasswordPlaceholder: 'New password',
      confirmPasswordPlaceholder: 'Confirm new password',
      passwordTooShort: 'Password must be at least 6 characters',
      passwordsDoNotMatch: 'Passwords do not match',
      updating: 'Updating…',
      updated: 'Updated',
      update: 'Update password',
      socialOnly: (provider: string) =>
        `You sign in with ${provider}: this account has no password. Manage it from your ${provider} account.`,
    },
    language: {
      title: 'Language',
      french: 'Français',
      english: 'English',
    },
    about: {
      title: 'About',
      version: 'Version',
      privacyPolicy: 'Privacy policy',
      termsOfService: 'Terms of service',
      notAvailableYet: 'Not available yet.',
    },
    deletion: {
      title: 'Delete account',
      action: 'Delete my account',
      employeeWarning:
        'Your sign-in, name, phone, photo, and any presence photos or positions are erased for good. Work already declared under your name stays in the company records without your identity.',
      chefWarning:
        'You are the only manager of this company. Deleting your account deletes the company: its sites, all declared work and presence records, and the accounts of every employee. This cannot be undone.',
      confirm: 'Delete for good',
      deleting: 'Deleting…',
      failed: 'Deletion failed. Check your connection and try again.',
    },
    signedInAs: (role: string) => `Signed in as ${role}`,
  },
};

export default en;
export type Translations = typeof en;
