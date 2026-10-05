import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * One person's activity, read by the chef who employs them.
 *
 * The screen this feeds used to invent its own contents from a hash of the
 * employee's id. What matters here is that the figures come from the records
 * and from nowhere else, and that nobody reads a person they do not employ.
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
/** Direct inspection, outside any role the app itself uses. */
const peek = async (sql, params = []) => (await db.query(sql, params)).rows;
const activity = async (reader, subject) =>
  (await as(reader, 'select public.employee_activity($1) as a', [subject]))[0].a;

test('employee activity', async t => {
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
  await as(ids.worker, "select public.set_presence_consent(true, '2026-09-07')");
  await as(ids.worker, 'select public.start_work_day($1, 8)', [ids.site]);
  const day = (await peek('select id from public.work_days'))[0].id;

  await t.test('an empty record reports nothing rather than inventing something', async () => {
    const a = await activity(ids.chef, ids.mate);
    assert.equal(a.day_count, 0);
    assert.equal(a.hours_total, 0);
    assert.deepEqual(a.days, []);
    // The person is still real even when there is nothing to show.
    assert.equal(a.person.first_name, 'Mate');
  });

  await t.test('declarations and hours come from the records', async () => {
    const code = (await as(ids.worker, 'select code, unit from public.task_codes limit 1'))[0];
    await as(ids.worker, 'select public.declare_task($1, $2, 5)', [day, code.code]);
    const a = await activity(ids.chef, ids.worker);
    assert.equal(a.day_count, 1);
    assert.equal(a.days.length, 1);
    assert.equal(a.days[0].site_name, 'Site A');
    assert.equal(a.days[0].open, true);
    assert.equal(a.days[0].tasks.length, 1);
    assert.equal(Number(a.days[0].tasks[0].quantity), 5);
    assert.equal(a.days[0].tasks[0].unit, code.unit);
    assert.equal(a.site_count, 1);
    // A day that has only just started has banked no hours worth reporting, and
    // the planned end is an intention rather than a record.
    assert.ok(Number(a.days[0].hours) < 1, 'hours counted from started_at, not planned_end_at');
  });

  await t.test('work the catalogue has no word for is written down anyway', async () => {
    await as(ids.worker, 'select public.declare_extra($1, $2) as e',
      [day, '  Coffrage refait, premier coulage raté  ']);
    await as(ids.worker, 'select public.declare_extra($1, $2)',
      [day, 'Demi-journée perdue à attendre la grue']);

    // The chef reads them on the day, in his own words, beside the codes.
    const seen = await activity(ids.chef, ids.worker);
    const notes = seen.days.find((d) => d.open).notes;
    assert.equal(notes.length, 2);
    assert.equal(notes[0].description, 'Coffrage refait, premier coulage raté');

    // Nothing empty, nothing endless, and not somebody else's day.
    await assert.rejects(as(ids.worker, 'select public.declare_extra($1, $2)', [day, '   ']),
      /Write what you did/);
    await assert.rejects(as(ids.worker, 'select public.declare_extra($1, $2)', [day, 'x'.repeat(501)]),
      /under 500 characters/);
    await assert.rejects(as(ids.mate, 'select public.declare_extra($1, $2)', [day, 'pas la mienne']),
      /Start a work day/);

    // Another company sees none of it, by the policy and not by the screen.
    assert.equal((await as(ids.otherChef, 'select * from public.extra_declarations')).length, 0);
    assert.equal((await as(ids.chef, 'select * from public.extra_declarations')).length, 2);

    // A mistake is correctable while the day is open, and only by its author.
    const entry = (await as(ids.worker, 'select id from public.extra_declarations order by declared_at desc limit 1'))[0].id;
    await as(ids.mate, 'select public.delete_extra($1)', [entry]).catch(() => {});
    assert.equal((await as(ids.chef, 'select * from public.extra_declarations')).length, 2);
    await as(ids.worker, 'select public.delete_extra($1)', [entry]);
    assert.equal((await as(ids.chef, 'select * from public.extra_declarations')).length, 1);

    // The table is never written directly.
    await assert.rejects(
      as(ids.worker, `insert into public.extra_declarations(work_day_id, employee_id, company_id, site_id, description)
                      values ($1, $2, $3, $4, 'x')`, [day, ids.worker, ids.company, ids.site]),
      /permission denied/
    );
  });

  await t.test('a day carries the proofs the chef asked for', async () => {
    // The two switches on the employee's card: the day is refused without
    // them, which is the whole point of their existing.
    await db.query('update public.profiles set equipment_photo_required = true where id = $1', [ids.mate]);
    await as(ids.mate, "select public.set_presence_consent(true, '2026-09-07')");
    // An app that cannot take a photo is not asked for one: the five accounts
    // that already had this switched on were locked out of their own work
    // days by a build that predates the camera step.
    await as(ids.mate, 'select public.start_work_day($1, 8)', [ids.site]);
    assert.equal(Number((await peek('select count(*) from public.work_day_photos'))[0].count), 0);
    await db.query('delete from public.work_days where employee_id = $1', [ids.mate]);

    // An app that can is refused without it.
    await assert.rejects(
      as(ids.mate, 'select public.start_work_day($1, 8, null, null, null, null, null, true)', [ids.site]),
      /safety equipment is required/
    );

    // With the photo, the day starts and the proof is stored with it.
    await as(ids.mate, `select public.start_work_day($1, 8, '${ids.mate}/gear.jpg', null, 33.57, -7.58, 9, true)`, [ids.site]);
    const proof = (await peek('select kind, photo_path, accuracy_meters from public.work_day_photos'))[0];
    assert.equal(proof.kind, 'equipment');
    assert.equal(proof.photo_path, `${ids.mate}/gear.jpg`);
    assert.equal(Number(proof.accuracy_meters), 9);

    // His chef sees it on the day; he sees his own.
    const seen = await activity(ids.chef, ids.mate);
    assert.equal(seen.days[0].photos.length, 1);
    assert.equal(seen.days[0].photos[0].kind, 'equipment');
    assert.equal((await activity(ids.mate, ids.mate)).days[0].photos.length, 1);

    // Nobody writes the table directly.
    await assert.rejects(
      as(ids.mate, `insert into public.work_day_photos(work_day_id, employee_id, company_id, kind, photo_path)
                    values ($1, $2, $3, 'clock_in', 'x')`,
        [(await peek('select id from public.work_days where employee_id = $1', [ids.mate]))[0].id, ids.mate, ids.company]),
      /permission denied/
    );

    // A worker the chef asked nothing of starts his day as he always did —
    // and the day this test opened is closed again, so the fixture is left as
    // it was found.
    await db.query('update public.profiles set equipment_photo_required = false where id = $1', [ids.mate]);
    await as(ids.mate, 'select public.end_work_day($1)',
      [(await peek('select id from public.work_days where employee_id = $1', [ids.mate]))[0].id]);
    await db.query('delete from public.work_days where employee_id = $1', [ids.mate]);
  });

  await t.test('a worker reads himself; nobody reads a person they do not employ', async () => {
    const mine = await activity(ids.worker, ids.worker);
    assert.equal(mine.day_count, 1);
    await assert.rejects(activity(ids.worker, ids.mate), /Not allowed/);
    await assert.rejects(activity(ids.otherChef, ids.worker), /Not allowed/);
    await assert.rejects(activity(null, ids.worker), /Sign in required/);
  });

  await t.test('a devis operation is ticked by whoever did it, on his own site', async () => {
    // A validated devis on the site the day was declared on, with one line and
    // two operations under it.
    const quote = (await peek(`
      insert into public.site_quotes (company_id, site_id, file_path, file_name, mime_type, status, uploaded_by, size_bytes)
      values ($1, $2, 'q/1.pdf', '1.pdf', 'application/pdf', 'validated', $3, 1024) returning id`,
      [ids.company, ids.site, ids.chef]))[0].id;
    const line = (await peek(`
      insert into public.quote_lines (quote_id, company_id, position, label, kind, unit, quantity)
      values ($1, $2, 0, 'Groupe 315 kVA posé en toiture', 'work', 'unit', 1) returning id`,
      [quote, ids.company]))[0].id;
    const steps = await peek(`
      insert into public.quote_line_steps (quote_line_id, company_id, position, label)
      values ($1, $2, 0, 'Poser les plots anti-vibrations'),
             ($1, $2, 1, 'Raccorder puissance, commande et terre')
      returning id, position`, [line, ids.company]);
    steps.sort((a, b) => a.position - b.position);

    // He ticks the first one.
    await as(ids.worker, 'select public.set_quote_line_step($1, true)', [steps[0].id]);
    let row = (await peek('select done_at, done_by, work_day_id from public.quote_line_steps where id = $1', [steps[0].id]))[0];
    assert.notEqual(row.done_at, null);
    assert.equal(row.done_by, ids.worker);
    assert.notEqual(row.work_day_id, null, 'the day it was done on is recorded');

    // Ticking again does not reassign it: the person who did the work keeps it.
    await as(ids.mate, "select public.set_presence_consent(true, '2026-09-07')");
    await as(ids.mate, 'select public.start_work_day($1, 8)', [ids.site]);
    await as(ids.mate, 'select public.set_quote_line_step($1, true)', [steps[0].id]);
    row = (await peek('select done_by from public.quote_line_steps where id = $1', [steps[0].id]))[0];
    assert.equal(row.done_by, ids.worker, 'credit stays with whoever did it');

    // Unticking clears it, which is how a mistaken tick is undone.
    await as(ids.worker, 'select public.set_quote_line_step($1, false)', [steps[0].id]);
    row = (await peek('select done_at, done_by from public.quote_line_steps where id = $1', [steps[0].id]))[0];
    assert.equal(row.done_at, null);
    assert.equal(row.done_by, null);

    // The day's lines now carry their operations, newest state included.
    await as(ids.worker, 'select public.set_quote_line_step($1, true)', [steps[1].id]);
    const day = (await peek('select id from public.work_days where employee_id = $1', [ids.worker]))[0].id;
    const rows = await as(ids.worker, 'select * from public.day_quote_lines($1)', [day]);
    const mine = rows.find((r) => r.line_id === line);
    assert.equal(mine.steps.length, 2);
    assert.equal(mine.steps[0].done, false);
    assert.equal(mine.steps[1].done, true);
    assert.equal(mine.steps[1].done_by_name, null, 'his own tick is not labelled with his name');
    // The mate sees who did it, because it was not him.
    const mateDay = (await peek('select id from public.work_days where employee_id = $1', [ids.mate]))[0].id;
    const theirs = (await as(ids.mate, 'select * from public.day_quote_lines($1)', [mateDay]))
      .find((r) => r.line_id === line);
    assert.equal(theirs.steps[1].done_by_name, 'Worker A');

    // Nobody writes the table directly, and nobody touches another company's.
    await assert.rejects(
      as(ids.worker, 'update public.quote_line_steps set done_at = now() where id = $1', [steps[0].id]),
      /permission denied/
    );
    await assert.rejects(
      as(ids.otherChef, 'select public.set_quote_line_step($1, true)', [steps[0].id]),
      /Start a work day|does not belong/
    );
  });

  await t.test('a second devis either replaces the first or adds to it, never silently both', async () => {
    const makeQuote = async (name) => (await peek(`
      insert into public.site_quotes (company_id, site_id, file_path, file_name, mime_type, status, uploaded_by, size_bytes)
      values ($1, $2, $3, $3, 'application/pdf', 'parsed', $4, 1024) returning id`,
      [ids.company, ids.site, name, ids.chef]))[0].id;
    const addLine = async (quote, label) => (await peek(`
      insert into public.quote_lines (quote_id, company_id, position, label, kind, unit, quantity)
      values ($1, $2, 0, $3, 'work', 'unit', 10) returning id`, [quote, ids.company, label]))[0].id;

    const first = await makeQuote('devis-v1.pdf');
    await addLine(first, 'Pose de 10 WC');
    await as(ids.chef, 'select public.validate_quote($1)', [first]);

    // A second devis on the same chantier: the question is asked because there
    // is something to ask about.
    const second = await makeQuote('devis-v2.pdf');
    const line2 = await addLine(second, 'Pose de 12 WC');
    // Other tests have validated a devis on this chantier too, so the first is
    // looked for rather than assumed to be alone.
    const inForce = await as(ids.chef, 'select * from public.quote_in_force($1)', [second]);
    const v1 = inForce.find((q) => q.file_name === 'devis-v1.pdf');
    assert.ok(v1, 'the devis in force is offered as the one to replace');
    assert.equal(v1.replaceable, true, 'nothing declared yet, so it can be replaced');

    // Replacing: the first stops being the target without being destroyed.
    await as(ids.chef, 'select public.validate_quote($1, $2)', [second, first]);
    const after = await peek('select id, status from public.site_quotes where id = any($1)', [[first, second]]);
    assert.equal(after.find((q) => q.id === first).status, 'superseded');
    assert.equal(after.find((q) => q.id === second).status, 'validated');

    // And the worker sees one devis's lines, not both stacked.
    const day = (await peek('select id from public.work_days where employee_id = $1', [ids.worker]))[0].id;
    const visible = await as(ids.worker, 'select label from public.day_quote_lines($1)', [day]);
    assert.equal(visible.some((r) => r.label === 'Pose de 12 WC'), true);
    assert.equal(visible.some((r) => r.label === 'Pose de 10 WC'), false, 'a replaced devis is no longer the work');

    // Once the chantier has run on a devis, replacing it is refused: the
    // declarations point at lines the new version may not have.
    await as(ids.worker, 'select public.declare_quote_line($1, $2, 3)', [day, line2]);
    const third = await makeQuote('devis-v3.pdf');
    await addLine(third, 'Pose de 14 WC');
    assert.equal(
      (await as(ids.chef, 'select * from public.quote_in_force($1)', [third]))
        .find((q) => q.file_name === 'devis-v2.pdf').replaceable,
      false
    );
    await assert.rejects(
      as(ids.chef, 'select public.validate_quote($1, $2)', [third, second]),
      /avenant/
    );
    // As an avenant it is accepted, and both count.
    await as(ids.chef, 'select public.validate_quote($1)', [third]);
    const both = await as(ids.worker, 'select label from public.day_quote_lines($1)', [day]);
    assert.equal(both.filter((r) => r.label.startsWith('Pose de')).length, 2);

    // Nobody but a chef of the company validates anything.
    await assert.rejects(as(ids.worker, 'select public.validate_quote($1)', [third]), /Only a chef/);
    await assert.rejects(as(ids.otherChef, 'select public.validate_quote($1)', [third]), /not found/i);
  });

  await t.test('the dashboard role reads aggregates and nothing else', async () => {
    // Every view answers, without the role holding a single table privilege.
    for (const view of ['companies', 'accounts', 'activity_weekly', 'presence_weekly', 'safety_weekly', 'consent']) {
      await as(null, `select * from reporting.${view}`, [], 'reporting_ro');
    }
    // The application tables stay out of reach, so a mistyped panel reaches nothing.
    for (const table of ['profiles', 'work_days', 'presence_check_ins', 'live_positions', 'safety_alerts']) {
      await assert.rejects(
        as(null, `select * from public.${table}`, [], 'reporting_ro'),
        /permission denied/,
        `public.${table} must not be readable by reporting_ro`
      );
    }
    // And no view carries a column that could name or locate a person.
    const columns = await peek(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'reporting'`);
    const forbidden = columns.filter((c) =>
      /name|_id$|^id$|latitude|longitude|phone|username|email|photo|token|password/i.test(c.column_name)
      && !/^(week|kind)$/.test(c.column_name));
    assert.deepEqual(forbidden, [], 'reporting views must expose no identifying column');
  });

  await t.test('the window is bounded however it is called', async () => {
    assert.equal((await as(ids.chef, 'select public.employee_activity($1, 9999) as a', [ids.worker]))[0].a.day_count, 1);
    assert.equal((await as(ids.chef, 'select public.employee_activity($1, -5) as a', [ids.worker]))[0].a.day_count, 1);
    assert.equal((await as(ids.chef, 'select public.employee_activity($1, null) as a', [ids.worker]))[0].a.day_count, 1);
  });
});
