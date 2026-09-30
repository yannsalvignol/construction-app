#!/usr/bin/env node
// One command for the whole demo company: accounts and chantiers, a month of
// history behind them, then live positions and declarations until you stop it.
//
//   npm run demo                  # seed what is missing, then run live
//   npm run demo -- --days=90     # a longer history
//   npm run demo -- --seed-only   # stop before the live simulation
//   npm run demo -- --reset       # delete the company first, then seed it again
//
// Every flag is passed through to the step it belongs to, so the three scripts
// stay usable on their own.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const passthrough = args.filter((a) => a.startsWith('--days='));

/** Runs one script to completion, inheriting stdio so its output is the output. */
function run(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, script), ...scriptArgs], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`))));
    child.on('error', reject);
  });
}

try {
  if (has('reset')) {
    console.log('— Suppression de l’entreprise de démonstration');
    await run('seed-quotes.mjs', ['--wipe']);
    await run('seed-castor-demo.mjs', ['--wipe']);
  }

  console.log('— Entreprise, employés, chantiers, planning');
  await run('seed-castor-demo.mjs');

  console.log('\n— Historique des journées et des tâches');
  await run('seed-history.mjs', passthrough);

  // After the history: the declarations that advance a devis hang off the
  // work days it creates.
  console.log('\n— Devis et avancement');
  await run('seed-quotes.mjs');

  if (has('seed-only')) {
    console.log('\n✔ Données en place. Lancez `npm run demo` sans --seed-only pour la simulation en direct.');
    process.exit(0);
  }

  console.log('\n— Positions et déclarations en direct (Ctrl-C pour arrêter)');
  await run('simulate-castor-live.mjs');
} catch (error) {
  console.error(`\n✖ ${error.message}`);
  process.exit(1);
}
