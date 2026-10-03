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
      /not both/
    );
    await assert.rejects(
      as(ids.chef, 'select public.set_quote_assignment(null, null, $1, true)', [ids.worker]),
      /not both/
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

  await t.test('nobody reads another company\'s assignments', async () => {
    assert.equal((await as(ids.otherChef, 'select * from public.quote_assignments')).length, 0);
    assert.ok((await as(ids.chef, 'select * from public.quote_assignments')).length > 0);
  });
});
