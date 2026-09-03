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
// Check 2: every EXPO_PUBLIC_* var the app reads is registered on EAS
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
  return found;
}

function checkEasEnvVars() {
  heading(`EAS environment variables for "${EAS_ENVIRONMENT}"`);

  const referenced = findReferencedPublicEnvVars();
  if (referenced.size === 0) {
    warn('No process.env.EXPO_PUBLIC_* references found in src/ or lib/, skipping.');
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
  if (!anyMissing && pluginNames.some((n) => PLUGIN_PERMISSION_KEYS[n])) {
    pass('Local ios/ project is in sync with app.json plugin config.');
  }
}

// ---------------------------------------------------------------------------

checkLockfileSync();
checkEasEnvVars();
checkNativeIosConfigSync();

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
