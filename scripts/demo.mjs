#!/usr/bin/env node
// The demonstration company, and the working day it is having.
//
//   npm run demo              # make sure Castor Ingénierie exists, then run the day
//   npm run demo -- --stop    # close the day and stop
//
// The company, its chantiers, its employees and anything done to them since —
// a devis read, a line ticked off, a photograph taken — are never touched.
// There is no reset: this script creates what is missing and runs, and nothing
// it does removes anything. Seeding a month of history and a devis happens once,
// when the company is created, because doing it again would write over work
// somebody has since done.
//
// Stopping closes today's declared days and clears the live positions. The
// declarations stay: they are the record of what was done.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const stop = args.includes('--stop');
const passthrough = args.filter((a) => a.startsWith('--days='));

/** Runs one script to completion, inheriting stdio so its output is the output. */
function run(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, script), ...scriptArgs], { stdio: 'inherit' });
    // 3 means seed-castor-demo found the company already there, which is the
    // ordinary case and not a failure.
    child.on('exit', (code) => (code === 0 || code === 3 ? resolve(code) : reject(new Error(`${script} exited with ${code}`))));
    child.on('error', reject);
  });
}

try {
  if (stop) {
    await run('simulate-castor-live.mjs', ['--stop']);
    process.exit(0);
  }

  console.log('— Entreprise, employés, chantiers, planning');
  const code = await run('seed-castor-demo.mjs');

  if (code === 0) {
    // Only on the run that created the company. Afterwards this is somebody's
    // chantier and the history is whatever actually happened on it.
    console.log('\n— Historique des journées et des tâches');
    await run('seed-history.mjs', passthrough);
    console.log('\n— Devis et avancement');
    await run('seed-quotes.mjs');
  }

  console.log('\n— Journées en cours et positions en direct (Ctrl-C pour arrêter)');
  await run('simulate-castor-live.mjs');
} catch (error) {
  console.error(`\n✖ ${error.message}`);
  process.exit(1);
}
