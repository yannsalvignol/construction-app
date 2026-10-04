#!/usr/bin/env node

/**
 * Catches the three mistakes that have each wasted a full EAS build cycle
 * (or a local rebuild) in this project:
 *
 * 1. package-lock.json drifted out of sync with package.json in a way
 *    `npm ci` rejects but `npm install` silently tolerates. `npm ci` is what
 *    EAS Build actually runs, and it fails the whole build in ~20s with no
 *    useful summary beyond "Install dependencies build phase" -- an
 *    expensive way to find out. `npm ci --dry-run` does NOT reliably catch
 *    this (it missed the exact bug that broke a real build here), so this
 *    check does a REAL install into a throwaway temp directory instead.
 *
 * 2. A native module reads `process.env.EXPO_PUBLIC_*` (e.g. Supabase URL/
 *    key) but that variable was never registered as an EAS environment
 *    variable for the target build profile. `.env`/`.env.local` are
 *    git-ignored, so EAS Build's upload never includes them -- the build
 *    SUCCEEDS with the variable simply undefined, and the app crashes at
 *    launch the moment it's read (e.g. supabase-js throws synchronously
 *    on `createClient(undefined, undefined)`). This produces a working
 *    .ipa that TestFlight happily distributes and then crashes on open --
 *    only caught by installing it on a device.
 *
 * 3. `app.json`'s config plugins (expo-location, expo-image-picker, ...)
 *    were never synced into a locally-generated `ios/` folder, because
 *    `expo run:ios` builds whatever's already in `ios/` and only
 *    `expo prebuild` re-syncs it from app.json. Calling a permission API
 *    with no matching Info.plist usage-description string is a hard OS
 *    -level crash on iOS, not a catchable JS error. This only affects
 *    local `expo run:ios`/`run:android` -- EAS cloud builds always
 *    prebuild fresh from app.json, so this check is skipped if `ios/`
 *    doesn't exist locally.
 *
 * Usage:
 *   node scripts/preflight-build.js [--env <eas-environment>]
 *   npm run preflight -- --env production
 *
 * Exits non-zero if any check fails.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.cwd();
const args = process.argv.slice(2);
const envFlagIndex = args.indexOf('--env');
const EAS_ENVIRONMENT = envFlagIndex !== -1 ? args[envFlagIndex + 1] : 'production';

let failures = 0;

function heading(title) {
  console.log(`\n=== ${title} ===`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
  failures += 1;
}

function warn(msg) {
  console.log(`  ! ${msg}`);
}

// ---------------------------------------------------------------------------
// Check 1: package-lock.json actually installs cleanly with `npm ci`
// ---------------------------------------------------------------------------
function checkLockfileSync() {
  heading('package-lock.json sync (npm ci, matching what EAS Build runs)');

  const pkgJson = path.join(ROOT, 'package.json');
  const lockJson = path.join(ROOT, 'package-lock.json');
  if (!fs.existsSync(pkgJson) || !fs.existsSync(lockJson)) {
    warn('package.json or package-lock.json not found, skipping.');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-npm-ci-'));
  try {
    fs.copyFileSync(pkgJson, path.join(tmpDir, 'package.json'));
    fs.copyFileSync(lockJson, path.join(tmpDir, 'package-lock.json'));

    // Pinned to npm 10 (what EAS Build's current macOS image bundles with
    // Node 22) rather than whatever npm happens to be on the local PATH.
    // This check exists specifically to catch package-lock.json entries
    // that are incomplete for optional/platform-specific transitive deps
    // (seen in practice with @emnapi/core, @emnapi/runtime) -- and that
    // exact incompleteness is npm-version-dependent: a lockfile npm 11
    // considers complete can still be rejected by npm 10's `ci`. Using the
    // local npm here silently stopped catching the bug it was written for
    // the moment local npm was upgraded past EAS's version.
    execFileSync('npx', ['--yes', 'npm@10', 'ci', '--include=dev', '--ignore-scripts'], {
      cwd: tmpDir,
      stdio: 'pipe',
    });
    pass('npm@10 ci --include=dev succeeds in a clean install.');
  } catch (error) {
    fail('npm ci fails against a clean install -- this WILL fail on EAS Build.');
    const output = (error.stderr || error.stdout || String(error)).toString();
    console.log(
      output
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => `      ${line}`)
        .join('\n')
    );
    console.log('    Fix: rm -rf node_modules package-lock.json && npm install');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Check 2: every env var the app (or app.config.js) reads is registered on EAS
// ---------------------------------------------------------------------------
function findReferencedPublicEnvVars() {
  const found = new Set();
  const pattern = /process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g;
  const searchDirs = ['src', 'lib'].map((d) => path.join(ROOT, d));

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf8');
        let match;
        while ((match = pattern.exec(content))) {
          found.add(match[1]);
        }
      }
    }
  }

  searchDirs.forEach(walk);

  // app.config.js also reads env at prebuild time (not EXPO_PUBLIC_, since
  // the value only needs to reach the native manifest). Same failure mode if
  // it's missing on EAS: the build succeeds and Android maps render blank.
  const appConfig = path.join(ROOT, 'app.config.js');
  if (fs.existsSync(appConfig)) {
    const content = fs.readFileSync(appConfig, 'utf8');
    const anyEnv = /process\.env\.([A-Z0-9_]+)/g;
    let match;
    while ((match = anyEnv.exec(content))) {
      found.add(match[1]);
    }
  }

  return found;
}

function checkEasEnvVars() {
  heading(`EAS environment variables for "${EAS_ENVIRONMENT}"`);

  const referenced = findReferencedPublicEnvVars();
  if (referenced.size === 0) {
    warn('No process.env references found in src/, lib/ or app.config.js, skipping.');
    return;
  }

  let whoami;
  try {
    whoami = execFileSync('npx', ['eas-cli', 'whoami'], { cwd: ROOT, stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    whoami = null;
  }
  if (!whoami || whoami.toLowerCase().includes('not logged in')) {
    warn('Not logged in to eas-cli (npx eas-cli login) -- skipping this check.');
    return;
  }

  let listOutput;
  try {
    listOutput = execFileSync('npx', ['eas-cli', 'env:list', EAS_ENVIRONMENT], {
      cwd: ROOT,
      stdio: 'pipe',
    }).toString();
  } catch (error) {
    fail(`Could not fetch EAS env vars for "${EAS_ENVIRONMENT}": ${error.message}`);
    return;
  }

  const registered = new Set(
    listOutput
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)=/))
      .filter(Boolean)
      .map((m) => m[1])
  );

  let anyMissing = false;
  for (const name of referenced) {
    if (registered.has(name)) {
      pass(`${name} is set on EAS for "${EAS_ENVIRONMENT}".`);
    } else {
      anyMissing = true;
      fail(
        `${name} is read by the app but NOT set on EAS for "${EAS_ENVIRONMENT}" -- ` +
          `the build will succeed and then crash (or silently misbehave) at runtime.`
      );
    }
  }
  if (anyMissing) {
    console.log(
      `    Fix: npx eas-cli env:create --environment ${EAS_ENVIRONMENT} --name <NAME> ` +
        `--value <VALUE> --visibility plaintext --type string`
    );
  }
}

// ---------------------------------------------------------------------------
// Check 3: local ios/ Info.plist has the usage strings app.json's plugins need
// ---------------------------------------------------------------------------
const PLUGIN_PERMISSION_KEYS = {
  'expo-location': ['NSLocationWhenInUseUsageDescription'],
  'expo-image-picker': ['NSPhotoLibraryUsageDescription'],
  'expo-camera': ['NSCameraUsageDescription'],
  'expo-av': ['NSMicrophoneUsageDescription'],
};

function checkNativeIosConfigSync() {
  heading('Local ios/ project matches app.json plugin config');

  const iosDir = path.join(ROOT, 'ios');
  if (!fs.existsSync(iosDir)) {
    warn('No local ios/ folder -- EAS Build always prebuilds fresh from app.json, skipping.');
    return;
  }

  const infoPlistPath = fs
    .readdirSync(iosDir)
    .map((name) => path.join(iosDir, name, 'Info.plist'))
    .find((p) => fs.existsSync(p));

  if (!infoPlistPath) {
    warn('Could not locate ios/*/Info.plist, skipping.');
    return;
  }

  const plistContent = fs.readFileSync(infoPlistPath, 'utf8');
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const plugins = appJson.expo?.plugins ?? [];
  const pluginNames = plugins.map((p) => (Array.isArray(p) ? p[0] : p));

  let anyMissing = false;
  for (const pluginName of pluginNames) {
    const requiredKeys = PLUGIN_PERMISSION_KEYS[pluginName];
    if (!requiredKeys) continue;
    for (const key of requiredKeys) {
      if (plistContent.includes(`<key>${key}</key>`)) {
        pass(`${key} present (from "${pluginName}" plugin).`);
      } else {
        anyMissing = true;
        fail(
          `${key} is missing from Info.plist even though "${pluginName}" is configured ` +
            `in app.json -- calling its permission API will hard-crash the app on a real device/build.`
        );
      }
    }
  }
  if (anyMissing) {
    console.log('    Fix: npx expo prebuild --platform ios   (safe -- ios/ is git-ignored)');
  }
  // The maps key is not a permission string, so the loop above never looked
  // for it — and a local ios/ generated before the key was configured builds
  // happily, links no Google Maps SDK, and renders a map that loads for ever.
  // No error, no crash, just a grey rectangle.
  // react-native-maps is configured in app.config.js, not app.json, so there
  // is no plugin entry here to look for — the key being set is the signal.
  {
    // Unconditional: app.config.js always hands react-native-maps an iOS key,
    // so Info.plist must always carry it. Gating this on the environment
    // variable made the check skip itself, since this script does not load
    // .env the way the Expo CLI does — a check that quietly does nothing is
    // worse than no check, because it reads as a pass.
    const hasKey = plistContent.includes('GMSApiKey');
    if (!hasKey) {
      fail(
        'app.json configures Google Maps for iOS, but local ios/Info.plist has no GMSApiKey.\n' +
          '    The app will build and its maps will load for ever, with no error.\n' +
          '    Fix: npx expo prebuild --platform ios   (safe -- ios/ is git-ignored)'
      );
      anyMissing = true;
    } else if (hasKey) {
      pass('Local ios/ project carries the Google Maps key.');
    }
  }

  if (!anyMissing && pluginNames.some((n) => PLUGIN_PERMISSION_KEYS[n])) {
    pass('Local ios/ project is in sync with app.json plugin config.');
  }
}


/**
 * 4. A native dependency was added, or a config plugin changed, without
 *    `version` being bumped in app.json.
 *
 *    The runtimeVersion policy is "appVersion": every build and every OTA
 *    update of version 1.0.0 are declared compatible. That is what makes the
 *    update reliable -- the runtime version is a literal string both sides
 *    read from the same file, where the "fingerprint" policy would hash the
 *    git-ignored ios/ and android/ directories, which EAS regenerates in the
 *    cloud and this machine generated at some other time. A one-byte
 *    difference there means a different runtime version and an update that
 *    silently never arrives.
 *
 *    The price of that reliability is this rule: native changes MUST come
 *    with a new `version`. Break it and `eas update` will happily publish JS
 *    that calls into a native module the installed binary does not have,
 *    which is a crash on launch for every user who takes the update -- with
 *    no review process in the way to catch it.
 *
 *    So the native dependency list is recorded beside the version it shipped
 *    with, and this compares the two.
 */
function checkRuntimeVersionBump() {
  heading('Runtime version vs native dependencies');
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const version = appJson.expo?.version;
  const policy = appJson.expo?.runtimeVersion?.policy;
  if (policy !== 'appVersion') {
    warn(`runtimeVersion policy is "${policy}", not "appVersion" -- this check assumes appVersion.`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // Anything that can carry native code: an expo-* module, react-native-*, or
  // a config plugin named in app.json.
  const native = Object.keys(pkg.dependencies || {})
    .filter((name) => /^(expo$|expo-|react-native-|@react-native)/.test(name))
    .sort()
    .map((name) => `${name}@${pkg.dependencies[name]}`);
  // The plugins as they are actually resolved, arguments included, hashed
  // rather than stored: an argument can be an API key, and a record file is
  // not a place for one. Names alone were not enough — handing
  // react-native-maps an iOS key rewrites Info.plist, which is as native a
  // change as adding the module, and the name never moves.
  let resolved = JSON.stringify(appJson.expo?.plugins ?? []);
  try {
    resolved = execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
      .split('\n')
      .pop();
    // Argument NAMES, never their values. Handing react-native-maps an
    // `iosGoogleMapsApiKey` at all is a native change — Info.plist gains a
    // key. Changing what that key's value is, or which environment variable
    // it comes from, is not: the binary has the same shape and an OTA update
    // is as safe as it was. Hashing the values made this fire on any machine
    // whose environment differed, which is every machine, and a check that
    // cries wolf gets bumped past.
    resolved = JSON.stringify(
      (JSON.parse(resolved).plugins ?? []).map((p) =>
        Array.isArray(p) ? [p[0], Object.keys(p[1] ?? {}).sort()] : p
      )
    );
  } catch {
    warn('Could not resolve app config; comparing the plugin list as written.');
  }
  const plugins = require('crypto').createHash('sha256').update(resolved).digest('hex').slice(0, 16);
  const fingerprint = JSON.stringify({ native, plugins });

  const recordPath = path.join(ROOT, 'scripts', '.native-at-version.json');
  let record = null;
  try { record = JSON.parse(fs.readFileSync(recordPath, 'utf8')); } catch { /* first run */ }

  if (!record) {
    fs.writeFileSync(recordPath, JSON.stringify({ version, fingerprint }, null, 2) + '\n');
    pass(`Recorded the native dependencies shipping with version ${version}.`);
    return;
  }

  if (record.fingerprint === fingerprint) {
    pass(`No native change since version ${record.version}; OTA updates stay compatible.`);
    return;
  }
  if (record.version !== version) {
    fs.writeFileSync(recordPath, JSON.stringify({ version, fingerprint }, null, 2) + '\n');
    pass(`Native dependencies changed and version was bumped to ${version}.`);
    return;
  }
  fail(
    `Native dependencies or config plugins changed, but app.json "version" is still ${version}.\n` +
      `    Every build and OTA update of ${version} are declared compatible, so an update\n` +
      `    published now would reach binaries that lack the new native code.\n` +
      `    Fix: bump "version" in app.json, then build. Updating the record alone is not enough.`
  );
}

// ---------------------------------------------------------------------------

checkLockfileSync();
checkEasEnvVars();
checkNativeIosConfigSync();
checkRuntimeVersionBump();

console.log(
  `\nNot automated (needs a human decision, and applies live changes): ` +
    `supabase/config.toml vs the remote project's Auth settings can drift silently. ` +
    `After editing config.toml's [auth] section, review and run ` +
    `\`supabase config push\` deliberately.\n`
);

if (failures > 0) {
  console.log(`${failures} check(s) failed -- fix these before running \`eas build\`.\n`);
  process.exit(1);
} else {
  console.log('All automated checks passed.\n');
}
