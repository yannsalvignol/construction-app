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
    instructions: 'Instructions',
    map: 'Presence',
    report: 'Tasks',
    account: 'Account',
  },

  webTabBar: {
    docs: 'Docs',
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
      firstNamePlaceholder: 'First name',
      lastNamePlaceholder: 'Last name',
      phonePlaceholder: 'Phone (optional)',
      usernamePlaceholder: 'Username',
      passwordPlaceholder: 'Password',
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
    signedInAs: (role: string) => `Signed in as ${role}`,
  },
};

export default en;
export type Translations = typeof en;
