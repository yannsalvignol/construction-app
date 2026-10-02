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

  await t.test('a worker reads himself; nobody reads a person they do not employ', async () => {
    const mine = await activity(ids.worker, ids.worker);
    assert.equal(mine.day_count, 1);
    await assert.rejects(activity(ids.worker, ids.mate), /Not allowed/);
    await assert.rejects(activity(ids.otherChef, ids.worker), /Not allowed/);
    await assert.rejects(activity(null, ids.worker), /Sign in required/);
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
