import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * Handing out the work, and striking out what should not be done.
 *
 * Two rules carry the feature. An assignment says what is expected and never
 * what is permitted — a worker who was given nothing still sees the chantier
 * and may still tick it, because a crew covers for each other. And a thing that
 * records work already done is never deleted: an operation somebody ticked, or
 * a line somebody declared against, stays whatever the chef thinks of it now.
 */
const db = new PGlite();
const ids = {
  chef: '10000000-0000-0000-0000-000000000001',
  worker: '10000000-0000-0000-0000-000000000002',
  mate: '10000000-0000-0000-0000-000000000003',
  otherChef: '10000000-0000-0000-0000-000000000004',
  company: '20000000-0000-0000-0000-000000000001',
  otherCompany: '20000000-0000-0000-0000-000000000002',
  site: '30000000-0000-0000-0000-000000000001',
};
async function as(user, sql, params = [], role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    await db.exec('set local role ' + role);
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result.rows;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const peek = async (sql, params = []) => (await db.query(sql, params)).rows;

test('handing out devis work', async t => {
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth, storage to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, created_at timestamptz default now(), unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] $$;
    create publication supabase_realtime;
  `);
  for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).sort()) {
    let sql = await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
    if (name.includes('initial_schema')) {
      sql = sql.replace(/create extension if not exists postgis\s+schema extensions;/, '')
        .replaceAll('extensions.geography(Point, 4326)', 'text')
        .replace(/create index \w+\s+on public\.\w+\s+using gist \(location\);/g, '');
    }
    try { await db.exec(sql); } catch (error) { throw new Error(name + ': ' + error.message); }
  }
  await db.exec(`
    insert into auth.users values ('${ids.chef}','chef@example.test'),('${ids.worker}','w@employee.local'),
      ('${ids.mate}','m@employee.local'),('${ids.otherChef}','other@example.test');
    insert into public.companies(id,name) values ('${ids.company}','A'),('${ids.otherCompany}','B');
    insert into public.profiles(id, company_id, first_name, last_name, role) values
      ('${ids.chef}','${ids.company}','Chef','A','chef'),
      ('${ids.worker}','${ids.company}','Worker','A','employee'),
      ('${ids.mate}','${ids.company}','Mate','A','employee'),
      ('${ids.otherChef}','${ids.otherCompany}','Chef','B','chef');
    insert into public.sites(id,company_id,name,address,latitude,longitude) values
      ('${ids.site}','${ids.company}','Site A','1 rue A','33.5731','-7.5898');
  `);

  const quote = (await peek(`
    insert into public.site_quotes (company_id, site_id, file_path, file_name, mime_type, status, uploaded_by, size_bytes)
    values ($1, $2, 'q/1.pdf', '1.pdf', 'application/pdf', 'validated', $3, 1024) returning id`,
    [ids.company, ids.site, ids.chef]))[0].id;
  const lines = await peek(`
    insert into public.quote_lines (quote_id, company_id, position, label, kind, unit, quantity)
    values ($1, $2, 0, 'Poste asservi 2 voies', 'work', 'unit', 1),
           ($1, $2, 1, 'Chemins de câbles', 'work', 'm', 40)
    returning id, position`, [quote, ids.company]);
  lines.sort((a, b) => a.position - b.position);
  const [poste, chemins] = lines.map((l) => l.id);
  const steps = (await peek(`
    insert into public.quote_line_steps (quote_line_id, company_id, position, label)
    values ($1, $2, 0, 'Fixer'), ($1, $2, 1, 'Câbler les asservissements'), ($1, $2, 2, 'Tester')
    returning id, position`, [poste, ids.company])).sort((a, b) => a.position - b.position);

  for (const who of [ids.worker, ids.mate]) {
    await as(who, "select public.set_presence_consent(true, '2026-09-07')");
    await as(who, 'select public.start_work_day($1, 8)', [ids.site]);
  }
  const dayOf = async (who) =>
    (await peek('select id from public.work_days where employee_id = $1', [who]))[0].id;
  const linesFor = async (who) => as(who, 'select * from public.day_quote_lines($1)', [await dayOf(who)]);

  await t.test('only a chef of the right company hands out work', async () => {
    await assert.rejects(
      as(ids.worker, 'select public.set_quote_assignment($1, null, $2, true)', [poste, ids.worker]),
      /Only a chef/
    );
    await assert.rejects(
      as(ids.otherChef, 'select public.set_quote_assignment($1, null, $2, true)', [poste, ids.worker]),
      /not in your company/
    );
    // A line and an operation at once is not an assignment, it is two.
    await assert.rejects(
      as(ids.chef, 'select public.set_quote_assignment($1, $2, $3, true)', [poste, steps[0].id, ids.worker]),
      /not several/
    );
    await assert.rejects(
      as(ids.chef, 'select public.set_quote_assignment(null, null, $1, true)', [ids.worker]),
      /not several/
    );
    // Nobody writes the table directly.
    await assert.rejects(
      as(ids.worker, 'insert into public.quote_assignments (company_id, quote_line_id, employee_id) values ($1,$2,$3)',
        [ids.company, poste, ids.worker]),
      /permission denied/
    );
  });

  await t.test('a line, an operation, and taking them back', async () => {
    await as(ids.chef, 'select public.set_quote_assignment($1, null, $2, true)', [chemins, ids.worker]);
    // Twice is not an error: a double tap on a slow connection is not a fault.
    await as(ids.chef, 'select public.set_quote_assignment($1, null, $2, true)', [chemins, ids.worker]);
    assert.equal(Number((await peek('select count(*) from public.quote_assignments'))[0].count), 1);

    await as(ids.chef, 'select public.set_quote_assignment(null, $1, $2, true)', [steps[1].id, ids.mate]);

    const his = await linesFor(ids.worker);
    const byId = Object.fromEntries(his.map((r) => [r.line_id, r]));
    assert.equal(byId[chemins].mine, true);
    assert.equal(byId[poste].mine, false, 'the poste was given to the mate, operation by operation');
    assert.equal(byId[poste].assigned, true, 'but somebody has it');

    const theirs = Object.fromEntries((await linesFor(ids.mate)).map((r) => [r.line_id, r]));
    assert.equal(theirs[poste].mine, true, 'one operation of a line makes the line his');
    assert.deepEqual(theirs[poste].steps.map((s) => s.mine), [false, true, false]);
    assert.deepEqual(theirs[poste].steps.map((s) => s.assigned), [false, true, false]);

    // Taking it back, and taking back what was never given.
    await as(ids.chef, 'select public.set_quote_assignment($1, null, $2, false)', [chemins, ids.worker]);
    await as(ids.chef, 'select public.set_quote_assignment($1, null, $2, false)', [chemins, ids.worker]);
    const after = Object.fromEntries((await linesFor(ids.worker)).map((r) => [r.line_id, r]));
    assert.equal(after[chemins].mine, false);
    assert.equal(after[chemins].assigned, false, 'nobody has it, so it reads as open');
  });

  await t.test('an assignment says what is expected, never what is permitted', async () => {
    // The poste belongs to the mate. The worker ticks one of its operations
    // anyway, because that is what happens on a chantier.
    await as(ids.worker, 'select public.set_quote_line_step($1, true)', [steps[2].id]);
    const row = (await peek('select done_by from public.quote_line_steps where id = $1', [steps[2].id]))[0];
    assert.equal(row.done_by, ids.worker);
    await as(ids.worker, 'select public.set_quote_line_step($1, false)', [steps[2].id]);
  });

  await t.test('a closed account takes no new work but keeps what it had', async () => {
    await as(ids.chef, 'select public.set_quote_assignment(null, $1, $2, true)', [steps[0].id, ids.mate]);
    await db.query('update public.profiles set is_active = false where id = $1', [ids.mate]);
    await assert.rejects(
      as(ids.chef, 'select public.set_quote_assignment(null, $1, $2, true)', [steps[2].id, ids.mate]),
      /account is closed/
    );
    assert.equal(
      Number((await peek('select count(*) from public.quote_assignments where step_id = $1', [steps[0].id]))[0].count),
      1, 'what was already given stays on the record'
    );
    await db.query('update public.profiles set is_active = true where id = $1', [ids.mate]);
  });

  await t.test('an operation is deleted until it records work', async () => {
    await assert.rejects(
      as(ids.worker, 'select public.delete_quote_line_step($1)', [steps[2].id]),
      /Only a chef/
    );
    await assert.rejects(
      as(ids.otherChef, 'select public.delete_quote_line_step($1)', [steps[2].id]),
      /does not exist/
    );
    await as(ids.chef, 'select public.delete_quote_line_step($1)', [steps[2].id]);
    assert.equal(Number((await peek('select count(*) from public.quote_line_steps where id = $1', [steps[2].id]))[0].count), 0);
    // Its assignments go with it rather than pointing at nothing.
    assert.equal(Number((await peek('select count(*) from public.quote_assignments where step_id = $1', [steps[2].id]))[0].count), 0);

    // One that was ticked is a record of work, and stays.
    await as(ids.worker, 'select public.set_quote_line_step($1, true)', [steps[1].id]);
    await assert.rejects(
      as(ids.chef, 'select public.delete_quote_line_step($1)', [steps[1].id]),
      /already done/
    );
  });

  await t.test('a line is deleted until something has been declared on it', async () => {
    await assert.rejects(
      as(ids.worker, 'select public.delete_quote_line($1)', [chemins]),
      /Only a chef/
    );
    await assert.rejects(
      as(ids.otherChef, 'select public.delete_quote_line($1)', [chemins]),
      /does not exist/
    );
    // The poste carries a ticked operation, so it carries work.
    await assert.rejects(
      as(ids.chef, 'select public.delete_quote_line($1)', [poste]),
      /already been declared/
    );
    // And a line with a declaration against it.
    await as(ids.worker, 'select public.declare_quote_line($1, $2, 5)', [await dayOf(ids.worker), chemins]);
    await assert.rejects(
      as(ids.chef, 'select public.delete_quote_line($1)', [chemins]),
      /already been declared/
    );

    // A fresh line goes, with its operations.
    const spare = (await peek(`
      insert into public.quote_lines (quote_id, company_id, position, label, kind, unit, quantity)
      values ($1, $2, 2, 'Ligne en trop', 'work', 'unit', 1) returning id`, [quote, ids.company]))[0].id;
    await peek(`insert into public.quote_line_steps (quote_line_id, company_id, position, label)
                values ($1, $2, 0, 'Rien')`, [spare, ids.company]);
    await as(ids.chef, 'select public.set_quote_assignment($1, null, $2, true)', [spare, ids.worker]);
    await as(ids.chef, 'select public.delete_quote_line($1)', [spare]);
    assert.equal(Number((await peek('select count(*) from public.quote_lines where id = $1', [spare]))[0].count), 0);
    assert.equal(Number((await peek('select count(*) from public.quote_line_steps where quote_line_id = $1', [spare]))[0].count), 0);
    assert.equal(Number((await peek('select count(*) from public.quote_assignments where quote_line_id = $1', [spare]))[0].count), 0);
  });

  await t.test('the site list says what is waiting for him there', async () => {
    const siteRow = async (who) =>
      (await as(who, 'select public.employee_workspace() as w'))[0].w.sites.find((s) => s.id === ids.site);

    // Nothing of the worker's is left: the chemins were taken back earlier and
    // the spare line is gone.
    assert.equal(Number((await siteRow(ids.worker)).awaiting), 0);

    // Two things named on him: a line with quantity left, and an operation.
    await as(ids.chef, 'select public.set_quote_assignment($1, null, $2, true)', [chemins, ids.worker]);
    await as(ids.chef, 'select public.set_quote_assignment(null, $1, $2, true)', [steps[0].id, ids.worker]);
    assert.equal(Number((await siteRow(ids.worker)).awaiting), 2);

    // Ticking the operation takes it off the count: work done is not waiting.
    await as(ids.worker, 'select public.set_quote_line_step($1, true)', [steps[0].id]);
    assert.equal(Number((await siteRow(ids.worker)).awaiting), 1);

    // And declaring the line's whole quantity takes the line off too. The
    // declaration is the day's figure for that line, not an addition to it.
    await as(ids.worker, 'select public.declare_quote_line($1, $2, 40)', [await dayOf(ids.worker), chemins]);
    assert.equal(Number((await siteRow(ids.worker)).awaiting), 0);

    // The mate was named on none of it and sees nothing.
    assert.equal(Number((await siteRow(ids.mate)).awaiting), 0);

    // A devis still being checked is not work anybody was asked for.
    await as(ids.worker, 'select public.set_quote_line_step($1, false)', [steps[0].id]);
    assert.equal(Number((await siteRow(ids.worker)).awaiting), 1);
    await db.query("update public.site_quotes set status = 'parsed' where id = $1", [quote]);
    assert.equal(Number((await siteRow(ids.worker)).awaiting), 0, 'an unvalidated devis asks nothing of anybody');
    await db.query("update public.site_quotes set status = 'validated' where id = $1", [quote]);
  });

  await t.test('a devis comes back at the depth it is printed', async () => {
    // A second devis shaped like a real one: a lot, numbered chapters inside
    // it, a sub-chapter inside one of those, and a second lot that reuses the
    // same chapter numbers.
    const deep = (await peek(`
      insert into public.site_quotes (company_id, site_id, file_path, file_name, mime_type, status, uploaded_by, size_bytes)
      values ($1, $2, 'q/2.pdf', '2.pdf', 'application/pdf', 'validated', $3, 1024) returning id`,
      [ids.company, ids.site, ids.chef]))[0].id;
    const rows = [
      // The lot heading carries the bare marker; its name lives in lot, which
      // is the shape the parser writes today.
      ['A Courant fort', 'A', 'heading'],
      ['A Courant fort', '1 Poste de transformation client', 'heading'],
      ['A Courant fort', '1.1 Cellules MT étanches', 'heading'],
      ['A Courant fort', '1.1.1 Interrupteur', 'heading'],
      ['A Courant fort', "1.1.1.2 Borne de l'interrupteur", 'work'],
      ['A Courant fort', '1.1.2 Cellule étanche de comptage', 'work'],
      ['A Courant fort', '1.2 Liaison moyenne tension', 'work'],
      ['A Courant fort', '2 Circuits de terre', 'heading'],
      ['A Courant fort', '2.1 Prise de terre informatique', 'work'],
      ['B Courant faible', 'B', 'heading'],
      ['B Courant faible', '1 Détection incendie', 'heading'],
      ['B Courant faible', '1.1 Détecteurs', 'work'],
    ];
    for (const [lot, label, kind] of rows.map((r, i) => [...r, i])) {
      await peek(`insert into public.quote_lines (quote_id, company_id, position, lot, label, kind, unit, quantity)
                  values ($1, $2, $3, $4, $5, $6, 'unit', 1)`,
        [deep, ids.company, 100 + rows.findIndex((r) => r[1] === label), lot, label, kind]);
    }

    const seen = Object.fromEntries(
      (await linesFor(ids.worker)).map((r) => [r.label, r]));

    assert.deepEqual(seen['1.1.1.2 Borne de l\'interrupteur'].path, [
      'A Courant fort', '1 Poste de transformation client',
      '1.1 Cellules MT étanches', '1.1.1 Interrupteur',
    ], 'four levels, because the devis has four');

    assert.deepEqual(seen['1.1.2 Cellule étanche de comptage'].path, [
      'A Courant fort', '1 Poste de transformation client', '1.1 Cellules MT étanches',
    ]);

    // Two deep: it sits under the chapter, beside the sub-chapters, as printed.
    assert.deepEqual(seen['1.2 Liaison moyenne tension'].path,
      ['A Courant fort', '1 Poste de transformation client']);

    // The lot scopes the lookup: B has a chapter "1" of its own, and its
    // lines must not be filed under A's.
    assert.deepEqual(seen['1.1 Détecteurs'].path,
      ['B Courant faible', '1 Détection incendie']);

    // A devis that numbers nothing and names no lot has no levels at all,
    // exactly as before: one flat list.
    assert.equal(seen['Chemins de câbles'].section, null);
    assert.deepEqual(seen['Chemins de câbles'].path, []);

    // A devis numbered another way entirely — "1-", "2-", "10-" with lettered
    // variants under them, which is how a second devis in this trade is
    // printed. Nothing there is a prefix of anything, so grouping has to come
    // from where the headings are, not from how they are numbered.
    const other = [
      ['LOT: CLIMATISATION', 'LOT: CLIMATISATION', 'heading'],
      ['LOT: CLIMATISATION', '1- UNITE EXTERIEURE DRV', 'heading'],
      ['LOT: CLIMATISATION', 'a- Pf : 60.3 kw', 'work'],
      ['LOT: CLIMATISATION', '2- UNITE INTERIEURE GAINABLE', 'heading'],
      ['LOT: CLIMATISATION', 'b- Pf : 7,1 kw', 'work'],
      ['LOT: CLIMATISATION', '3- RESEAUX FRIGORIFIQUES', 'work'],
    ];
    for (let i = 0; i < other.length; i += 1) {
      await peek(`insert into public.quote_lines (quote_id, company_id, position, lot, label, kind, unit, quantity)
                  values ($1, $2, $3, $4, $5, $6, 'unit', 1)`,
        [deep, ids.company, 200 + i, other[i][0], other[i][1], other[i][2]]);
    }
    const clim = Object.fromEntries((await linesFor(ids.worker)).map((r) => [r.label, r]));

    assert.deepEqual(clim['a- Pf : 60.3 kw'].path,
      ['LOT: CLIMATISATION', '1- UNITE EXTERIEURE DRV'],
      'a lettered variant sits inside whatever heading is open');
    assert.deepEqual(clim['b- Pf : 7,1 kw'].path,
      ['LOT: CLIMATISATION', '2- UNITE INTERIEURE GAINABLE'],
      'and the next heading closes the one before it');
    // The one that matters: a numbered line is a sibling of the numbered
    // headings, not a child of the last one.
    assert.deepEqual(clim['3- RESEAUX FRIGORIFIQUES'].path, ['LOT: CLIMATISATION'],
      'a line of the same rank as the heading above it stands beside it');

    await db.query('delete from public.site_quotes where id = $1', [deep]);
  });

  await t.test('a whole part of the devis is handed over at once', async () => {
    const deep = (await peek(`
      insert into public.site_quotes (company_id, site_id, file_path, file_name, mime_type, status, uploaded_by, size_bytes)
      values ($1, $2, 'q/3.pdf', '3.pdf', 'application/pdf', 'validated', $3, 1024) returning id`,
      [ids.company, ids.site, ids.chef]))[0].id;
    const rows = [
      ['A Courant fort', 'A', 'heading'],
      ['A Courant fort', '1 Poste de transformation', 'heading'],
      ['A Courant fort', '1.1 Cellule étanche', 'work'],
      ['A Courant fort', '1.2 Transformateur', 'work'],
      ['A Courant fort', '2 Circuits de terre', 'heading'],
      ['A Courant fort', '2.1 Piquets de terre', 'work'],
      ['B Courant faible', 'B', 'heading'],
      ['B Courant faible', '1.1 Détecteurs', 'work'],
    ];
    for (let i = 0; i < rows.length; i += 1) {
      await peek(`insert into public.quote_lines (quote_id, company_id, position, lot, label, kind, unit, quantity)
                  values ($1, $2, $3, $4, $5, $6, 'unit', 1)`,
        [deep, ids.company, 300 + i * 10, rows[i][0], rows[i][1], rows[i][2]]);
    }
    const part = ['A Courant fort', '1 Poste de transformation'];

    await assert.rejects(
      as(ids.worker, 'select public.set_quote_assignment(null, null, $1, true, $2, $3)',
        [ids.worker, deep, part]),
      /Only a chef/
    );
    await assert.rejects(
      as(ids.otherChef, 'select public.set_quote_assignment(null, null, $1, true, $2, $3)',
        [ids.worker, deep, part]),
      /not in your company/
    );
    // A part without the devis it belongs to names nothing.
    await assert.rejects(
      as(ids.chef, 'select public.set_quote_assignment(null, null, $1, true, null, $2)', [ids.worker, part]),
      /needs the devis/
    );
    await assert.rejects(
      as(ids.chef, 'select public.set_quote_assignment($1, null, $2, true, $3, $4)',
        [chemins, ids.worker, deep, part]),
      /not several/
    );

    await as(ids.chef, 'select public.set_quote_assignment(null, null, $1, true, $2, $3)',
      [ids.worker, deep, part]);
    // Twice is not an error.
    await as(ids.chef, 'select public.set_quote_assignment(null, null, $1, true, $2, $3)',
      [ids.worker, deep, part]);

    const seen = Object.fromEntries((await linesFor(ids.worker)).map((r) => [r.label, r]));
    assert.equal(seen['1.1 Cellule étanche'].mine, true, 'everything under the part is his');
    assert.equal(seen['1.2 Transformateur'].mine, true);
    assert.equal(seen['2.1 Piquets de terre'].mine, false, 'the next part is not');
    assert.equal(seen['1.1 Détecteurs'].mine, false, 'and nor is lot B, which numbers the same way');
    assert.equal(seen['2.1 Piquets de terre'].assigned, false);

    // A line added inside that part afterwards is his too: the chef gave away
    // the part of the chantier, not the lines it held that day.
    await peek(`insert into public.quote_lines (quote_id, company_id, position, lot, label, kind, unit, quantity)
                values ($1, $2, 335, 'A Courant fort', '1.3 Cellule de comptage', 'work', 'unit', 1)`,
      [deep, ids.company]);
    const after = (await linesFor(ids.worker)).find((r) => r.label === '1.3 Cellule de comptage');
    assert.equal(after.mine, true);

    // The lot itself hands over everything below it, including lines that sit
    // under no heading.
    await as(ids.chef, 'select public.set_quote_assignment(null, null, $1, true, $2, $3)',
      [ids.mate, deep, ['A Courant fort']]);
    const theirs = Object.fromEntries((await linesFor(ids.mate)).map((r) => [r.label, r]));
    assert.equal(theirs['2.1 Piquets de terre'].mine, true);
    assert.equal(theirs['1.1 Détecteurs'].mine, false);

    // And it counts as the work it is, not as one task.
    const site = (await as(ids.mate, 'select public.employee_workspace() as w'))[0].w
      .sites.find((s) => s.id === ids.site);
    assert.ok(Number(site.awaiting) >= 4, `a part is every line under it (got ${site.awaiting})`);

    // Taken back.
    await as(ids.chef, 'select public.set_quote_assignment(null, null, $1, false, $2, $3)',
      [ids.mate, deep, ['A Courant fort']]);
    assert.equal(
      (await linesFor(ids.mate)).find((r) => r.label === '2.1 Piquets de terre').mine, false);

    await db.query('delete from public.site_quotes where id = $1', [deep]);
  });

  await t.test('a devis is deleted until it has been worked on', async () => {
    const spare = (await peek(`
      insert into public.site_quotes (company_id, site_id, file_path, file_name, mime_type, status, uploaded_by, size_bytes)
      values ($1, $2, 'q/9.pdf', '9.pdf', 'application/pdf', 'stored', $3, 10) returning id`,
      [ids.company, ids.site, ids.chef]))[0].id;

    await assert.rejects(
      as(ids.worker, 'select public.delete_site_quote($1)', [spare]), /Only a chef/);
    await assert.rejects(
      as(ids.otherChef, 'select public.delete_site_quote($1)', [spare]), /Quote not found/);

    // Nothing declared against it: it goes.
    await as(ids.chef, 'select public.delete_site_quote($1)', [spare]);
    assert.equal(Number((await peek('select count(*) from public.site_quotes where id = $1', [spare]))[0].count), 0);

    // The one that has been worked on stays. Its declarations point at its
    // lines and at no catalogue code, so deleting it would leave somebody's
    // day pointing at nothing — which is what the database was refusing with
    // a constraint violation the screen could not explain.
    await assert.rejects(
      as(ids.chef, 'select public.delete_site_quote($1)', [quote]),
      /already been declared/
    );
    assert.equal(Number((await peek('select count(*) from public.site_quotes where id = $1', [quote]))[0].count), 1);
  });

  await t.test('a company reads five devis a day, and the sixth is refused', async () => {
    const make = async (n) => (await peek(`
      insert into public.site_quotes (company_id, site_id, file_path, file_name, mime_type, status, uploaded_by, size_bytes)
      values ($1, $2, $3, $3, 'application/pdf', 'stored', $4, 10) returning id`,
      [ids.company, ids.site, `limit-${n}.pdf`, ids.chef]))[0].id;

    await db.query('update public.site_quotes set parsing_started_at = null where company_id = $1', [ids.company]);
    const made = [];
    for (let n = 0; n < 6; n += 1) made.push(await make(n));

    for (let n = 0; n < 5; n += 1) {
      await as(ids.chef, 'select public.claim_quote_parse($1)', [made[n]]);
    }
    assert.equal(Number((await as(ids.chef, 'select public.quote_parses_left() as n'))[0].n), 0);

    await assert.rejects(
      as(ids.chef, 'select public.claim_quote_parse($1)', [made[5]]),
      /Daily devis reading limit reached/
    );

    // Re-reading one already counted today is not a sixth document.
    await as(ids.chef, 'select public.claim_quote_parse($1)', [made[0]]);

    // Only a chef, only his own company.
    await assert.rejects(
      as(ids.worker, 'select public.claim_quote_parse($1)', [made[0]]), /Only a chef/);
    await assert.rejects(
      as(ids.otherChef, 'select public.claim_quote_parse($1)', [made[0]]), /Quote not found/);

    // The ceiling is a setting, raised without a deploy.
    await db.query('update public.companies set daily_parse_limit = 20 where id = $1', [ids.company]);
    await as(ids.chef, 'select public.claim_quote_parse($1)', [made[5]]);
    assert.equal(Number((await as(ids.chef, 'select public.quote_parses_left() as n'))[0].n), 14);

    await db.query('update public.companies set daily_parse_limit = 5 where id = $1', [ids.company]);
    await db.query('delete from public.site_quotes where id = any($1)', [made]);
  });

  await t.test('fifteen days, then the account is locked', async () => {
    const access = async (who) => (await as(who, 'select public.company_access() as a'))[0].a;

    // A company that pays is never locked, whatever its trial dates say.
    await db.query(`update public.companies set subscription_active = true,
                    trial_started_at = now() - interval '90 days' where id = $1`, [ids.company]);
    assert.equal((await access(ids.chef)).locked, false);

    // On trial: usable, and the screen can say how long is left.
    await db.query(`update public.companies set subscription_active = false,
                    trial_started_at = now() - interval '14 days' where id = $1`, [ids.company]);
    const left = await access(ids.chef);
    assert.equal(left.locked, false);
    assert.equal(left.days_left, 1);

    // Expired: locked, and the database refuses what costs money rather than
    // trusting a screen to have stopped him.
    await db.query(`update public.companies set trial_started_at = now() - interval '16 days'
                    where id = $1`, [ids.company]);
    assert.equal((await access(ids.chef)).locked, true);
    await assert.rejects(
      as(ids.chef, 'select public.claim_quote_parse($1)', [quote]),
      /needs to be unlocked/
    );

    // Three days he can take for himself, one at a time, and then no more.
    assert.equal((await access(ids.chef)).grace_left, 3);
    for (const left of [2, 1, 0]) {
      const after = (await as(ids.chef, 'select public.take_grace_day() as a'))[0].a;
      assert.equal(after.locked, false, 'a day taken opens the app');
      assert.equal(after.grace_left, left);
      // The writes open too, not just the screen.
      await as(ids.chef, 'select public.require_company_access()');
      // Spending the next one is only allowed once this one has run out.
      await assert.rejects(as(ids.chef, 'select public.take_grace_day()'), /not locked/);
      await db.query(`update public.companies set grace_until = now() - interval '1 minute'
                      where id = $1`, [ids.company]);
      assert.equal((await access(ids.chef)).locked, true);
    }
    await assert.rejects(as(ids.chef, 'select public.take_grace_day()'), /No more days/);
    await assert.rejects(
      as(ids.chef, 'select public.claim_quote_parse($1)', [quote]),
      /needs to be unlocked/
    );

    // Nobody but a chef spends his company's days.
    await assert.rejects(as(ids.worker, 'select public.take_grace_day()'), /Only a chef/);

    // The crew follows a week later, not at midnight with the chef.
    {
      const employeeAccess = async () => (await as(ids.worker, 'select public.company_access() as a'))[0].a;
      await db.query(`update public.companies set grace_until = null, grace_days_used = 0,
                      trial_started_at = now() - interval '16 days' where id = $1`, [ids.company]);
      // Chef stopped; the man on the chantier is not.
      assert.equal((await access(ids.chef)).locked, true);
      assert.equal((await employeeAccess()).locked, false);
      await as(ids.worker, 'select public.require_company_access()');
      // Day six: still working.
      await db.query(`update public.companies set trial_started_at = now() - interval '21 days'
                      where id = $1`, [ids.company]);
      assert.equal((await employeeAccess()).locked, false);
      // Day eight: stopped too, and the database refuses a new day rather
      // than trusting a screen to have stopped him.
      await db.query(`update public.companies set trial_started_at = now() - interval '23 days'
                      where id = $1`, [ids.company]);
      assert.equal((await employeeAccess()).locked, true);
      await assert.rejects(as(ids.worker, 'select public.require_company_access()'), /needs to be unlocked/);
      await assert.rejects(
        as(ids.worker, 'select public.start_work_day($1, 8)', [ids.site]),
        /needs to be unlocked/
      );
      // A day the chef buys back carries his men with it.
      await as(ids.chef, 'select public.take_grace_day()');
      assert.equal((await access(ids.chef)).locked, false);
      assert.equal((await employeeAccess()).locked, false);
      await db.query(`update public.companies set grace_until = null, grace_days_used = 0,
                      trial_started_at = now() - interval '16 days' where id = $1`, [ids.company]);
    }

    // Unlocked by hand, which is how this is sold.
    await db.query('update public.companies set subscription_active = true where id = $1', [ids.company]);
    assert.equal((await access(ids.chef)).locked, false);
    await as(ids.chef, 'select public.claim_quote_parse($1)', [quote]);

    // The notice is shown once.
    assert.equal((await access(ids.chef)).notice_seen, false);
    await as(ids.chef, 'select public.mark_trial_notice_seen()');
    assert.equal((await access(ids.chef)).notice_seen, true);
  });

  await t.test('nobody reads another company\'s assignments', async () => {
    assert.equal((await as(ids.otherChef, 'select * from public.quote_assignments')).length, 0);
    assert.ok((await as(ids.chef, 'select * from public.quote_assignments')).length > 0);
  });
});
