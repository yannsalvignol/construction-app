import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * Protection du travailleur isolé, against real PostgreSQL.
 *
 * These used to be unit tests of a JS timer on the phone. That timer could never
 * have fired: iOS delivers background location on distance, not on time, so the
 * phone of a worker who has stopped moving stops running the very code meant to
 * notice he had stopped moving. The deadline lives on the server now, and what
 * has to be tested is that silence raises the alarm.
 */
const db = new PGlite();
const ids = {
  chef: '10000000-0000-0000-0000-000000000001',
  worker: '10000000-0000-0000-0000-000000000002',
  company: '20000000-0000-0000-0000-000000000001',
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
/** The cron worker, with exactly the access the dispatcher has in production. */
const cron = (sql, params) => as(null, sql, params, 'service_role');
/** Direct inspection for assertions, outside any role the app itself uses. */
const peek = async (sql, params = []) => (await db.query(sql, params)).rows;
/** Rewinds the watch's clock, which is how time passes in a test. */
const rewind = (minutes, column = 'last_moved_at') =>
  peek(`update public.lone_worker_watches set ${column} = ${column} - ($1 || ' minutes')::interval`, [String(minutes)]);
const openAlerts = () =>
  peek("select * from public.safety_alerts where resolved_at is null and kind = 'no_movement'");

// Two points ~90 m apart, and one a couple of metres away: past and short of the
// 35 m that separates walking from shifting your weight.
const here = [33.5731, -7.5898];
const far = [33.5739, -7.5898];
const nudge = [33.57311, -7.5898];

test('lone worker protection', async t => {
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
    insert into auth.users values ('${ids.chef}', 'chef@example.test'), ('${ids.worker}', 'worker@employee.local');
    insert into public.companies(id,name) values ('${ids.company}', 'Company A');
    insert into public.profiles(id, company_id, first_name, last_name, role) values
      ('${ids.chef}', '${ids.company}', 'Chef', 'A', 'chef'),
      ('${ids.worker}', '${ids.company}', 'Worker', 'A', 'employee');
    insert into public.sites(id,company_id,name,address,latitude,longitude) values
      ('${ids.site}', '${ids.company}', 'Site A', '1 rue A, Casablanca', 33.5731, -7.5898);
  `);
  await as(ids.worker, "select public.set_presence_consent(true, '2026-09-07')");
  await as(ids.worker, 'select public.start_work_day($1, 8)', [ids.site]);

  await t.test('the watch runs on a declared day with no live sharing enabled', async () => {
    // The whole point of the rearrangement: with the chef's map switched off
    // for this worker, nobody is tracking anybody, and the watch still runs.
    await peek("update public.profiles set location_mode = 'checkpoint' where id = $1", [ids.worker]);
    const mode = await as(ids.worker, 'select location_mode from public.profiles where id = auth.uid()');
    assert.equal(mode[0].location_mode, 'checkpoint');
    const reply = await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10) as r', here);
    assert.equal(reply[0].r.day_open, true);
    assert.equal(reply[0].r.live, false);
    assert.equal(reply[0].r.watching, true);
    const watch = await peek('select * from public.lone_worker_watches');
    assert.equal(watch.length, 1);
  });

  await t.test('a worker who keeps moving is never questioned', async () => {
    await rewind(20);
    await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10)', far);
    // Moving reset the clock, so the sweep twenty minutes later finds nothing.
    await rewind(20);
    await cron('select * from public.claim_lone_worker_questions()');
    const watch = await peek('select asked_at from public.lone_worker_watches');
    assert.equal(watch[0].asked_at, null);
  });

  await t.test('shifting weight on the spot does not count as movement', async () => {
    // Walk back to the reference point first: stillness is measured from where he
    // actually is, not from where the test last mentioned.
    await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10)', here);
    const before = await peek('select last_moved_at from public.lone_worker_watches');
    await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10)', nudge);
    const after = await peek('select last_moved_at from public.lone_worker_watches');
    assert.equal(after[0].last_moved_at.getTime(), before[0].last_moved_at.getTime());
  });

  await t.test('a phone that goes quiet is asked, then raises if unanswered', async () => {
    await rewind(26);
    await cron('select * from public.claim_lone_worker_questions()');
    const asked = await peek('select asked_at from public.lone_worker_watches');
    assert.notEqual(asked[0].asked_at, null);
    // Inside the answer window nothing is raised yet.
    assert.equal(await cron('select public.raise_due_lone_worker_alerts() as n').then(r => r[0].n), 0);
    assert.equal((await openAlerts()).length, 0);

    await rewind(4, 'asked_at');
    assert.equal(await cron('select public.raise_due_lone_worker_alerts() as n').then(r => r[0].n), 1);
    const alerts = await openAlerts();
    assert.equal(alerts.length, 1);
    // The alert carries where he was, which is the reason position is needed at all.
    assert.equal(Number(alerts[0].latitude.toFixed(4)), here[0]);
    assert.equal(alerts[0].work_day_id !== null, true);
  });

  await t.test('an alert is raised once, not on every sweep that follows', async () => {
    await rewind(10, 'asked_at');
    assert.equal(await cron('select public.raise_due_lone_worker_alerts() as n').then(r => r[0].n), 0);
    assert.equal((await openAlerts()).length, 1);
  });

  await t.test('answering clears the question and the alert his silence raised', async () => {
    await as(ids.worker, 'select public.confirm_lone_worker_ok()');
    assert.equal((await openAlerts()).length, 0);
    const watch = await peek('select asked_at from public.lone_worker_watches');
    assert.equal(watch[0].asked_at, null);
    // And the clock restarts from his answer rather than from his last step.
    await cron('select * from public.claim_lone_worker_questions()');
    assert.equal((await peek('select asked_at from public.lone_worker_watches'))[0].asked_at, null);
  });

  await t.test('moving again answers the question by itself', async () => {
    await rewind(26);
    await cron('select * from public.claim_lone_worker_questions()');
    assert.notEqual((await peek('select asked_at from public.lone_worker_watches'))[0].asked_at, null);
    await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10)', far);
    assert.equal((await peek('select asked_at from public.lone_worker_watches'))[0].asked_at, null);
    assert.equal(await cron('select public.raise_due_lone_worker_alerts() as n').then(r => r[0].n), 0);
  });

  await t.test('a worker who turned the watch off is not watched', async () => {
    await as(ids.worker, 'select public.set_lone_worker_watch(false)');
    assert.equal((await peek('select count(*)::int as n from public.lone_worker_watches'))[0].n, 0);
    await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10)', here);
    assert.equal((await peek('select count(*)::int as n from public.lone_worker_watches'))[0].n, 0);
    await as(ids.worker, 'select public.set_lone_worker_watch(true)');
  });

  await t.test('the watch is his, not his employer\'s', async () => {
    await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10)', here);
    // A chef may see an alert, but not the minute-by-minute stillness of his hands.
    assert.equal((await as(ids.chef, 'select * from public.lone_worker_watches')).length, 0);
    assert.equal((await as(ids.worker, 'select * from public.lone_worker_watches')).length, 1);
    // And no client may drive the sweep, whatever it claims to be.
    await assert.rejects(as(ids.chef, 'select * from public.claim_lone_worker_questions()'), /permission denied/);
    await assert.rejects(as(ids.worker, 'select public.raise_due_lone_worker_alerts()'), /permission denied/);
    await assert.rejects(as(ids.chef, 'update public.profiles set lone_worker_watch = false where id = $1', [ids.worker]),
      /permission denied|new row violates/);
  });

  await t.test('a chef registers a device for alerts without any presence agreement', async () => {
    await as(ids.chef, "select public.register_chef_push('ExpoPushToken[chef-device]', 'fr')");
    assert.equal((await peek('select count(*)::int as n from private.push_tokens where employee_id = $1', [ids.chef]))[0].n, 1);
    // The consent-bound employee route is not a way in for a chef, and vice versa.
    await assert.rejects(as(ids.chef, "select public.register_presence_push('ExpoPushToken[chef-device]', 'fr')"), /agreement required/i);
    await assert.rejects(as(ids.worker, "select public.register_chef_push('ExpoPushToken[worker-device]', 'fr')"), /Chef account required/);
    // And the chef is reachable for an alert his crew raises.
    await as(ids.worker, "select public.raise_safety_alert('sos', 33.5731, -7.5898, 10)");
    const jobs = await cron('select * from public.claim_safety_alert_notifications()');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].token, 'ExpoPushToken[chef-device]');
    assert.equal(jobs[0].employee_name, 'Worker A');
    await cron('select public.finish_safety_alert_notification($1)', [jobs[0].alert_id]);
    // Told once, not on every sweep that follows.
    assert.equal((await cron('select * from public.claim_safety_alert_notifications()')).length, 0);
    await as(ids.chef, 'select public.resolve_safety_alert($1)', [jobs[0].alert_id]);
  });

  await t.test('the day ending stands the watch down', async () => {
    await as(ids.worker, 'select public.end_work_day($1)',
      [(await peek('select id from public.work_days'))[0].id]);
    const reply = await as(ids.worker, 'select public.safety_heartbeat($1, $2, 10) as r', here);
    assert.equal(reply[0].r.day_open, false);
    await rewind(30);
    await cron('select * from public.claim_lone_worker_questions()');
    assert.equal(await cron('select public.raise_due_lone_worker_alerts() as n').then(r => r[0].n), 0);
  });
});
