import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL execution in memory. Only the Supabase-managed auth/storage
// schemas and old, unused PostGIS columns are adapted for this test engine.
// All application migrations, functions, grants and RLS policies run unchanged.
const db = new PGlite();
const ids = {
  chef: '10000000-0000-0000-0000-000000000001', worker: '10000000-0000-0000-0000-000000000002',
  other: '10000000-0000-0000-0000-000000000003', otherChef: '10000000-0000-0000-0000-000000000004',
  company: '20000000-0000-0000-0000-000000000001', otherCompany: '20000000-0000-0000-0000-000000000002',
  site: '30000000-0000-0000-0000-000000000001', otherSite: '30000000-0000-0000-0000-000000000002',
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
async function scalar(user, sql, params, role) { return Object.values((await as(user, sql, params, role))[0])[0]; }

test('presence and productivity database contracts', async t => {
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
    insert into auth.users values ('${ids.chef}', 'chef@example.test'), ('${ids.worker}', 'worker@employee.local'), ('${ids.other}', 'other@employee.local'), ('${ids.otherChef}', 'other-chef@example.test');
    insert into public.companies(id,name) values ('${ids.company}', 'Company A'), ('${ids.otherCompany}', 'Company B');
    insert into public.profiles(id, company_id, first_name, last_name, role) values
      ('${ids.chef}', '${ids.company}', 'Chef', 'A', 'chef'), ('${ids.worker}', '${ids.company}', 'Worker', 'A', 'employee'),
      ('${ids.other}', '${ids.otherCompany}', 'Worker', 'B', 'employee'), ('${ids.otherChef}', '${ids.otherCompany}', 'Chef', 'B', 'chef');
    insert into public.sites(id,company_id,name,address,latitude,longitude) values
      ('${ids.site}', '${ids.company}', 'Site A', '1 rue A, Casablanca', 33.5731, -7.5898),
      ('${ids.otherSite}', '${ids.otherCompany}', 'Site B', '2 rue B, Rabat', 34.0209, -6.8416);
  `);

  await t.test('catalogue is a read-only, category-keyed list of coded tasks', async () => {
    const codes = await as(ids.worker, 'select * from public.task_codes');
    const categories = await as(ids.worker, 'select * from public.task_categories');
    // Several trades, each carrying tasks: the catalogue must stay a tree, not a flat list.
    assert.ok(categories.length > 1);
    assert.ok(codes.length > categories.length);
    const known = new Set(categories.map(c => c.code));
    assert.ok(codes.every(c => known.has(c.category_code)));
    assert.ok(codes.every(c => ['unit', 'm', 'm2', 'm3', 'kg'].includes(c.unit)));
    assert.ok(codes.every(c => c.label_fr && c.label_en));
    // The plumbing seed the catalogue started from is still addressable by its code.
    assert.equal(codes.filter(c => c.code === 'SAN_LAVABO' && c.unit === 'unit').length, 1);
    // Employees pick from the catalogue; they can never add a free-text task to it.
    await assert.rejects(as(ids.worker, "insert into public.task_codes values ('FREE','plumbing_hvac','Free','Free','unit',true,1)"), /permission denied/);
  });
  await t.test('consent is mandatory, versioned and cannot be supplied by another role', async () => {
    await assert.rejects(as(ids.worker, 'select public.start_work_day($1, 8)', [ids.site]), /agreement required/);
    await assert.rejects(as(ids.chef, 'select public.set_presence_consent(true)'), /Employee account required/);
    await assert.rejects(as(ids.worker, "select public.set_presence_consent(true, 'old')"), /current presence notice/);
    await assert.rejects(as(null, 'select public.set_presence_consent(true)', [], 'anon'), /permission denied/);
    await as(ids.worker, 'select public.set_presence_consent(true)');
    await assert.rejects(as(ids.worker, 'select public.set_presence_consent(null)'), /Explicit agreement/);
    assert.equal((await as(ids.worker, 'select * from public.presence_consent_events')).length, 1);
    await assert.rejects(as(ids.worker, 'delete from public.presence_consent_events'), /permission denied/);
  });
  await t.test('site and tenant restrictions apply to direct API calls', async () => {
    assert.equal((await as(ids.worker, 'select * from public.sites')).length, 1);
    await assert.rejects(as(ids.worker, 'select public.start_work_day($1, 8)', [ids.otherSite]), /active site/);
    await assert.rejects(as(ids.worker, "insert into public.sites(company_id,name,address,latitude,longitude) values ($1,'Fake','1 rue X, Casablanca',33.5,-7.6)", [ids.company]), /row-level security/);
    await assert.rejects(as(ids.chef, "insert into public.sites(company_id,name,address,latitude,longitude) values ($1,'Foreign','2 rue Y, Rabat',34.0,-6.8)", [ids.otherCompany]), /row-level security/);
    await assert.rejects(as(ids.worker, "update public.profiles set location_tracking_enabled = true where id = $1", [ids.worker]), /permission denied/);
    await assert.rejects(as(ids.worker, 'select public.update_own_employee_location(0::float8,0::float8)'), /does not exist/);
    await assert.rejects(db.query('update public.profiles set location_tracking_enabled=true where id=$1', [ids.worker]), /profiles_legacy_location_unused/);
  });

  const day = (await as(ids.worker, 'select * from public.start_work_day($1, 8)', [ids.site]))[0];
  const requests = (await db.query('select * from public.presence_requests order by due_at')).rows;
  const request = requests[0];
  await t.test('2–3 requests are spaced inside the day and future times stay private', async () => {
    assert.ok(requests.length === 2 || requests.length === 3);
    for (let i = 0; i < requests.length; i++) {
      assert.ok(new Date(requests[i].due_at) > new Date(day.started_at));
      assert.ok(new Date(requests[i].expires_at) < new Date(day.planned_end_at));
      if (i) assert.ok(new Date(requests[i].due_at) >= new Date(requests[i - 1].expires_at));
    }
    assert.equal((await as(ids.worker, 'select * from public.presence_requests')).length, 0);
    const workspace = await scalar(ids.worker, 'select public.employee_workspace()');
    assert.equal(workspace.requests.length, 0);
    assert.equal(workspace.day.id, day.id);
    await assert.rejects(as(ids.worker, 'select * from private.push_tokens'), /permission denied/);
    // An OPEN day is what blocks a second one, not the calendar date.
    await assert.rejects(as(ids.worker, 'select public.start_work_day($1, 8)', [ids.site]), /Finish your current work day/);
  });
  await t.test('future and expired requests cannot be submitted', async () => {
    await assert.rejects(as(ids.worker, "select public.submit_presence_check($1,'fake',now(),1,1,10)", [request.id]), /no longer active/);
    await db.query("update public.presence_requests set due_at = now() - interval '40 minutes', expires_at = now() - interval '10 minutes' where id = $1", [request.id]);
    await assert.rejects(as(ids.worker, "select public.submit_presence_check($1,'fake',now(),1,1,10)", [request.id]), /no longer active/);
    assert.equal((await scalar(ids.chef, 'select public.chef_dashboard()')).to_review, 1);
    await db.query("update public.presence_requests set due_at = now() - interval '1 minute', expires_at = now() + interval '29 minutes' where id = $1", [request.id]);
  });
  const photo = ids.worker + '/' + request.id + '/proof.jpg';
  await t.test('fresh photo and GPS are required and attached to the declared site', async () => {
    await assert.rejects(as(ids.worker, 'select public.submit_presence_check($1,$2,now(),1,1,10)', [request.id, photo]), /photo is missing/);
    await as(ids.worker, "insert into storage.objects(bucket_id,name) values ('presence-proofs',$1)", [photo]);
    await assert.rejects(as(ids.worker, "select public.submit_presence_check($1,$2,now()-interval '5 minutes',1,1,10)", [request.id, photo]), /new photo/);
    await assert.rejects(as(ids.other, 'select public.submit_presence_check($1,$2,now(),1,1,10)', [request.id, photo]), /not found/);
    await assert.rejects(as(ids.worker, 'select public.submit_presence_check($1,$2,now(),91,1,10)', [request.id, photo]), /check constraint/);
    await as(ids.worker, 'select public.submit_presence_check($1,$2,now(),33.5,-7.6,12)', [request.id, photo]);
    const check = (await as(ids.worker, 'select * from public.presence_check_ins'))[0];
    assert.equal(check.site_id, ids.site);
    assert.equal(check.employee_id, ids.worker);
    await assert.rejects(as(ids.worker, 'select public.submit_presence_check($1,$2,now(),1,1,10)', [request.id, photo]), /unique constraint/);
  });
  await t.test('proofs are private across companies and immutable for employees', async () => {
    assert.equal((await as(ids.otherChef, 'select * from public.presence_check_ins')).length, 0);
    assert.equal((await as(ids.otherChef, "select * from storage.objects where bucket_id='presence-proofs'")).length, 0);
    assert.equal((await as(ids.chef, "select * from storage.objects where bucket_id='presence-proofs'")).length, 1);
    assert.equal((await as(ids.worker, 'delete from storage.objects where name=$1 returning name', [photo])).length, 0);
    await assert.rejects(as(ids.worker, 'delete from public.presence_check_ins'), /permission denied/);
  });
  await t.test('declarations use catalogue codes, validate quantities and save idempotently', async () => {
    await assert.rejects(as(ids.worker, "select public.declare_task($1,'some free text',1)", [day.id]), /catalogue/);
    await assert.rejects(as(ids.worker, "select public.declare_task($1,'SAN_WC',-1)", [day.id]), /valid quantity/);
    await assert.rejects(as(ids.worker, "select public.declare_task($1,'SAN_WC',1.5)", [day.id]), /whole number/);
    await assert.rejects(as(ids.worker, "select public.declare_task($1,'PLB_PPR_DN25',0.001)", [day.id]), /valid quantity/);
    await assert.rejects(as(ids.worker, "select public.declare_task($1,'PLB_PPR_DN25','NaN'::numeric)", [day.id]), /valid quantity/);
    await assert.rejects(as(ids.other, "select public.declare_task($1,'SAN_WC',2)", [day.id]), /Start a work day/);
    await as(ids.worker, "select public.declare_task($1,'SAN_WC',2)", [day.id]);
    await as(ids.worker, "select public.declare_task($1,'SAN_WC',3)", [day.id]);
    const rows = await as(ids.worker, 'select * from public.task_declarations');
    assert.equal(rows.length, 1); assert.equal(Number(rows[0].quantity), 3);
  });
  await t.test('dashboard returns actual company data, including joined employees', async () => {
    const joined = '10000000-0000-0000-0000-000000000005';
    await db.query("insert into auth.users values ($1,'joined@employee.local')", [joined]);
    const code = (await db.query('select join_code from public.companies where id=$1', [ids.company])).rows[0].join_code;
    await as(joined, "select public.redeem_employee_join_code($1,'Joined','Worker')", [code]);
    const data = await scalar(ids.chef, 'select public.chef_dashboard()');
    // The home screen leads with this absolute headcount, so a code-joined employee must land in it.
    assert.equal(data.employees, 2); assert.equal(data.active_employees, 2); assert.equal(data.confirmed, 1);
    assert.equal(data.declarations, 1); assert.equal(data.productivity[0].quantity, 3);
    assert.equal(data.flags.length, 0);
    // Suspending an employee leaves the total untouched and only moves the active count.
    await db.query('update public.profiles set is_active = false where id = $1', [joined]);
    const suspended = await scalar(ids.chef, 'select public.chef_dashboard()');
    assert.equal(suspended.employees, 2); assert.equal(suspended.active_employees, 1);
    await db.query('update public.profiles set is_active = true where id = $1', [joined]);
    await assert.rejects(as(ids.worker, 'select public.chef_dashboard()'), /Chef account/);
    assert.equal((await scalar(ids.otherChef, 'select public.chef_dashboard()')).confirmed, 0);
  });
  await t.test('a new site needs a located address, legacy sites stay updatable', async () => {
    await assert.rejects(as(ids.chef, "insert into public.sites(company_id,name) values ($1,'No address')", [ids.company]), /recognised by the map/);
    await assert.rejects(as(ids.chef, "insert into public.sites(company_id,name,address) values ($1,'No coords','12 rue Test')", [ids.company]), /recognised by the map/);
    await assert.rejects(as(ids.chef, "insert into public.sites(company_id,name,address,latitude,longitude) values ($1,'Blank','   ',33.5,-7.6)", [ids.company]), /recognised by the map/);
    await as(ids.chef, "insert into public.sites(company_id,name,address,latitude,longitude) values ($1,'Located','12 rue Test, Casablanca',33.5,-7.6)", [ids.company]);
    assert.equal(Number((await as(ids.chef, "select * from public.sites where name = 'Located'"))[0].latitude), 33.5);
    // A located site cannot silently lose its position.
    await assert.rejects(as(ids.chef, "update public.sites set latitude = null where name = 'Located'"), /recognised by the map/);
    // A site predating the rule keeps working: deactivating it must not start failing.
    // The trigger is lifted to create it exactly as it would exist from before the migration.
    await db.exec('alter table public.sites disable trigger sites_enforce_site_address');
    await db.query("insert into public.sites(id,company_id,name) values ('30000000-0000-0000-0000-000000000009',$1,'Legacy')", [ids.company]);
    await db.exec('alter table public.sites enable trigger sites_enforce_site_address');
    await as(ids.chef, "update public.sites set is_active = false where name = 'Legacy'");
    assert.equal((await as(ids.chef, "select * from public.sites where name = 'Legacy'"))[0].is_active, false);
    // Coordinates stay inside the company boundary like every other site column.
    assert.equal((await as(ids.other, "select * from public.sites where name = 'Located'")).length, 0);
    await db.query("delete from public.sites where name in ('Located','Legacy')");
  });
  await t.test('site roster lists who declared days there, scoped to the company', async () => {
    const roster = await scalar(ids.chef, 'select public.site_team($1)', [ids.site]);
    assert.equal(roster.length, 1);
    // Last seen comes from real evidence: the check-in already submitted on this site.
    assert.ok(roster[0].last_seen_at, 'a submitted check-in must count as being seen');
    assert.equal(roster[0].employee_name, 'Worker A');
    assert.equal(roster[0].present_today, true);
    assert.equal(Number(roster[0].days), 1);
    // A site with no declared day yields an empty roster, not an error.
    assert.equal((await scalar(ids.otherChef, 'select public.site_team($1)', [ids.otherSite])).length, 0);
    // Another company's site is not readable, and employees cannot call this at all.
    await assert.rejects(as(ids.otherChef, 'select public.site_team($1)', [ids.site]), /Site not found/);
    await assert.rejects(as(ids.worker, 'select public.site_team($1)', [ids.site]), /Chef account/);
  });
  await t.test('an employee can only be removed before they declare anything', async () => {
    const fresh = '10000000-0000-0000-0000-000000000007';
    await db.query("insert into auth.users values ($1,'fresh@employee.local')", [fresh]);
    await db.query("insert into public.profiles(id,company_id,first_name,last_name,role) values ($1,$2,'Fresh','Hire','employee')", [fresh, ids.company]);
    // Employees cannot remove anyone, and a chef cannot reach another company.
    await assert.rejects(as(ids.worker, 'select public.remove_employee($1)', [fresh]), /Chef account/);
    await assert.rejects(as(ids.otherChef, 'select public.remove_employee($1)', [fresh]), /Employee not found/);
    await assert.rejects(as(ids.chef, 'select public.remove_employee($1)', [ids.chef]), /Only an employee/);
    // Declared work belongs to the company, so the worker with a work day is kept.
    await assert.rejects(as(ids.chef, 'select public.remove_employee($1)', [ids.worker]), /declared work/);
    // The untouched hire goes, and the sign-in goes with them.
    await as(ids.chef, 'select public.remove_employee($1)', [fresh]);
    assert.equal((await db.query('select * from public.profiles where id=$1', [fresh])).rows.length, 0);
    assert.equal((await db.query('select * from auth.users where id=$1', [fresh])).rows.length, 0);
  });
  await t.test('live location needs the chef to enable it, the employee to agree, and an open day', async () => {
    // Live is the setup a company starts in, so the mode is put back to
    // checkpoint here to prove the gate still exists rather than to describe a
    // default.
    await db.query("update public.profiles set location_mode = 'checkpoint' where id = $1", [ids.worker]);
    // The chef's switch alone shares nothing: agreement is a separate, explicit act.
    await assert.rejects(as(ids.worker, 'select public.update_live_position(33.5::float8, -7.6::float8, 12::float8)'), /not enabled/);
    // A self-edit is not rejected, it is reverted by the trigger: the statement
    // reports success while the column keeps the chef's value.
    await as(ids.worker, "update public.profiles set location_mode = 'live' where id = $1", [ids.worker]);
    assert.equal((await as(ids.worker, 'select location_mode from public.profiles where id = $1', [ids.worker]))[0].location_mode, 'checkpoint');
    await db.query("update public.profiles set location_mode = 'live' where id = $1", [ids.worker]);
    await assert.rejects(as(ids.worker, 'select public.update_live_position(33.5::float8, -7.6::float8, 12::float8)'), /agreement required/);
    // Presence consent is a different purpose and must not unlock being followed.
    assert.equal((await as(ids.worker, 'select * from public.live_location_consents')).length, 0);
    await as(ids.worker, 'select public.set_live_location_consent(true)');
    await assert.rejects(as(ids.worker, "select public.set_live_location_consent(true, 'old')"), /current live location notice/);
    await as(ids.worker, 'select public.update_live_position(33.5::float8, -7.6::float8, 12::float8)');
    // Site A sits at 33.5731,-7.5898; the position above is roughly 8 km away.
    const away = (await as(ids.chef, 'select public.live_team()'))[0].live_team;
    assert.equal(away.length, 1);
    assert.equal(away[0].on_site, false);
    assert.ok(away[0].distance_meters > 5000);
    assert.equal((await scalar(ids.chef, 'select public.site_team($1)', [ids.site]))[0].on_site, false);
    // Standing on the site flips the flag rather than just moving the pin.
    await as(ids.worker, 'select public.update_live_position(33.5731::float8, -7.5898::float8, 8::float8)');
    const team = (await as(ids.chef, 'select public.live_team()'))[0].live_team;
    assert.equal(team[0].on_site, true);
    assert.ok(team[0].distance_meters < 100);
    // A stationary worker stops emitting, so an old position must keep showing:
    // vanishing from the map reads as "gone" and is worse than a dated pin.
    await db.query("update public.live_positions set recorded_at = now() - interval '3 hours' where employee_id = $1", [ids.worker]);
    assert.equal((await as(ids.chef, 'select public.live_team()'))[0].live_team.length, 1);
    assert.equal((await as(ids.worker, 'select * from public.live_positions')).length, 1);
    // Another company's chef never sees these positions.
    assert.equal((await as(ids.otherChef, 'select public.live_team()'))[0].live_team.length, 0);
    await assert.rejects(as(ids.other, 'select public.live_team()'), /Chef account/);
    assert.equal((await as(ids.other, 'select * from public.live_positions')).length, 0);
    // Withdrawal stops sharing and erases the last position, it does not merely hide it.
    await as(ids.worker, 'select public.set_live_location_consent(false)');
    assert.equal((await db.query('select * from public.live_positions')).rows.length, 0);
    await assert.rejects(as(ids.worker, 'select public.update_live_position(33.5::float8, -7.6::float8, 12::float8)'), /agreement required/);
    await as(ids.worker, 'select public.set_live_location_consent(true)');
    await as(ids.worker, 'select public.update_live_position(33.5::float8, -7.6::float8, 12::float8)');
    // Ending the day erases the position too, so nothing lingers after work.
    await as(ids.worker, 'select public.end_work_day($1)', [day.id]);
    assert.equal((await db.query('select * from public.live_positions')).rows.length, 0);
    assert.equal((await as(ids.chef, 'select public.live_team()'))[0].live_team.length, 0);
    await assert.rejects(as(ids.worker, 'select public.update_live_position(33.5::float8, -7.6::float8, 12::float8)'), /Start a work day/);
    // Reopen the shared fixture: end_work_day also cancels pending requests, which
    // later tests in this file rely on being live.
    await db.query('update public.work_days set ended_at = null where id = $1', [day.id]);
    await db.query('update public.presence_requests set cancelled_at = null where work_day_id = $1', [day.id]);
    await db.query("update public.profiles set location_mode = 'checkpoint' where id = $1", [ids.worker]);
  });
  await t.test('time on site accumulates without keeping any trail', async () => {
    await db.query("update public.profiles set location_mode = 'live' where id = $1", [ids.worker]);
    // Site A sits at 33.5731,-7.5898; the 5 km rule has to hold either side of it.
    assert.ok(await scalar(ids.worker, 'select public.distance_meters(33.5731,-7.5898,33.5731,-7.5898) < 1'));
    assert.ok(await scalar(ids.worker, 'select public.distance_meters(33.5731,-7.5898,33.6031,-7.5898) < 5000'));
    assert.ok(await scalar(ids.worker, 'select public.distance_meters(33.5731,-7.5898,33.7731,-7.5898) > 5000'));

    await as(ids.worker, 'select public.update_live_position(33.5731::float8, -7.5898::float8, 8::float8)');
    let row = (await db.query('select * from public.work_days where id=$1', [day.id])).rows[0];
    assert.equal(row.seconds_inside, 0, 'the first sample has nothing to attribute yet');
    assert.equal(row.last_sample_inside, true);

    // Two minutes on site, then a reading far away.
    await db.query("update public.work_days set last_sample_at = now() - interval '2 minutes' where id=$1", [day.id]);
    await as(ids.worker, 'select public.update_live_position(33.7731::float8, -7.5898::float8, 8::float8)');
    row = (await db.query('select * from public.work_days where id=$1', [day.id])).rows[0];
    assert.ok(row.seconds_inside >= 118 && row.seconds_inside <= 125);
    assert.equal(row.seconds_outside, 0);
    assert.equal(row.last_sample_inside, false);

    // Three minutes away are attributed to the outside bucket.
    await db.query("update public.work_days set last_sample_at = now() - interval '3 minutes' where id=$1", [day.id]);
    await as(ids.worker, 'select public.update_live_position(33.7731::float8, -7.5898::float8, 8::float8)');
    row = (await db.query('select * from public.work_days where id=$1', [day.id])).rows[0];
    assert.ok(row.seconds_outside >= 178 && row.seconds_outside <= 185);

    // A long silence is attributed to neither: we do not know where they were.
    const before = (await db.query('select * from public.work_days where id=$1', [day.id])).rows[0];
    await db.query("update public.work_days set last_sample_at = now() - interval '3 hours' where id=$1", [day.id]);
    await as(ids.worker, 'select public.update_live_position(33.5731::float8, -7.5898::float8, 8::float8)');
    row = (await db.query('select * from public.work_days where id=$1', [day.id])).rows[0];
    assert.equal(row.seconds_inside, before.seconds_inside);
    assert.equal(row.seconds_outside, before.seconds_outside);

    // Counters exist, the positions behind them do not: still one row, no history.
    assert.equal(Number((await db.query('select count(*) from public.live_positions')).rows[0].count), 1);
    await db.query("update public.profiles set location_mode = 'checkpoint' where id = $1", [ids.worker]);
  });
  await t.test('a work day can be cancelled only while it produced nothing', async () => {
    // The shared fixture day already carries a declaration and a check-in.
    await assert.rejects(as(ids.worker, 'select public.cancel_work_day($1)', [day.id]), /Finish it instead/);
    await assert.rejects(as(ids.other, 'select public.cancel_work_day($1)', [day.id]), /Work day not found/);

    // A day started by mistake, with nothing on it, disappears entirely.
    const fresh = (await db.query(`insert into public.work_days(employee_id, company_id, site_id, work_date, planned_end_at)
      values ($1,$2,$3,current_date,now() + interval '8 hours') returning *`, [ids.other, ids.otherCompany, ids.otherSite])).rows[0];
    await db.query("insert into public.presence_requests(work_day_id, employee_id, company_id, due_at, expires_at) values ($1,$2,$3,now(),now() + interval '30 minutes')",
      [fresh.id, ids.other, ids.otherCompany]);
    await as(ids.other, 'select public.cancel_work_day($1)', [fresh.id]);
    assert.equal((await db.query('select * from public.work_days where id=$1', [fresh.id])).rows.length, 0);
    // Its pending requests go with it rather than being left orphaned.
    assert.equal((await db.query('select * from public.presence_requests where work_day_id=$1', [fresh.id])).rows.length, 0);
  });
  await t.test('an employee reads back their own past days and nobody else\'s', async () => {
    const history = await scalar(ids.worker, 'select public.work_day_history(30)');
    assert.ok(history.length >= 1);
    const today = history.find(h => h.id === day.id);
    assert.equal(today.site_name, 'Site A');
    assert.ok(today.tasks.length >= 1, 'declared tasks come back with the day');
    assert.ok(today.tasks[0].label_fr && today.tasks[0].unit);
    assert.equal(Number(today.checks), 1);
    // Scoped to the caller: another employee's days never appear here.
    assert.equal((await scalar(ids.other, 'select public.work_day_history(30)')).length, 0);
    await assert.rejects(as(ids.chef, 'select public.work_day_history(30)'), /Employee account/);
    await assert.rejects(as(ids.worker, 'select public.work_day_history(0)'), /Invalid history range/);
  });
  await t.test('a worked site is archived, an unused one is deleted', async () => {
    // Site A carries the fixture's work day, so its history must survive.
    assert.equal(await scalar(ids.chef, 'select public.remove_site($1)', [ids.site]), 'archived');
    const archived = (await db.query('select * from public.sites where id=$1', [ids.site])).rows[0];
    assert.equal(archived.is_active, false);
    assert.ok((await db.query('select * from public.work_days where site_id=$1', [ids.site])).rows.length > 0);
    await db.query('update public.sites set is_active = true where id=$1', [ids.site]);

    // A site nobody ever worked on leaves nothing behind, so it goes for good.
    const unused = (await db.query(`insert into public.sites(company_id,name,address,latitude,longitude)
      values ($1,'Unused','9 rue Z, Casablanca',33.6,-7.6) returning *`, [ids.company])).rows[0];
    assert.equal(await scalar(ids.chef, 'select public.remove_site($1)', [unused.id]), 'deleted');
    assert.equal((await db.query('select * from public.sites where id=$1', [unused.id])).rows.length, 0);

    await assert.rejects(as(ids.worker, 'select public.remove_site($1)', [ids.site]), /Chef account/);
    await assert.rejects(as(ids.otherChef, 'select public.remove_site($1)', [ids.site]), /Site not found/);
  });
  await t.test('same task/site/quantity over three worked days flags without blocking', async () => {
    for (const offset of [1, 3]) {
      const prior = (await db.query(`insert into public.work_days(employee_id, company_id, site_id, work_date, started_at, planned_end_at, ended_at)
        select employee_id,company_id,site_id,work_date-$2::int,started_at-make_interval(days=>$2),planned_end_at-make_interval(days=>$2),planned_end_at-make_interval(days=>$2)
        from public.work_days where id=$1 returning id`, [day.id, offset])).rows[0].id;
      await db.query("insert into public.task_declarations(work_day_id,employee_id,company_id,site_id,task_code,quantity) values ($1,$2,$3,$4,'SAN_WC',3)", [prior, ids.worker, ids.company, ids.site]);
    }
    assert.equal((await scalar(ids.chef, 'select public.chef_dashboard()')).flags.length, 1);
    await as(ids.worker, "select public.declare_task($1,'SAN_WC',4)", [day.id]);
    assert.equal((await scalar(ids.chef, 'select public.chef_dashboard()')).flags.length, 0);
  });
  await t.test('push outbox is server-only and withdrawal stops new work and capture', async () => {
    await assert.rejects(as(ids.worker, 'select * from public.claim_presence_notifications()'), /permission denied/);
    await assert.rejects(as(ids.worker, 'select * from public.claim_presence_receipts()'), /permission denied/);
    await assert.rejects(as(null, 'select public.redact_expired_presence_evidence()', [], 'anon'), /permission denied/);
    await as(ids.worker, "select public.register_presence_push('ExpoPushToken[testtoken]', 'fr')");
    const second = requests[1];
    await db.query("update public.presence_requests set due_at=now()-interval '1 minute', expires_at=now()+interval '29 minutes' where id=$1", [second.id]);
    const jobs = await as(null, 'select * from public.claim_presence_notifications()', [], 'service_role');
    assert.equal(jobs.length, 1); assert.equal(jobs[0].request_id, second.id);
    assert.equal((await as(null, 'select * from public.claim_presence_notifications()', [], 'service_role')).length, 0, 'leased jobs cannot be claimed twice');
    await as(null, 'select public.finish_presence_notification($1,$2,$3)', [second.id, 'ExpoPushToken[testtoken]', 'ticket-1'], 'service_role');
    await db.exec("update private.presence_push_receipts set check_after=now()-interval '1 second'");
    assert.equal((await as(null, 'select * from public.claim_presence_receipts()', [], 'service_role')).length, 1);
    await as(null, "select public.resolve_presence_receipt('ticket-1','DeviceNotRegistered')", [], 'service_role');
    assert.equal((await db.query('select * from private.push_tokens')).rows.length, 0);
    assert.equal((await db.query('select notified_at from public.presence_requests where id=$1', [second.id])).rows[0].notified_at, null);
    await as(ids.worker, "select public.register_presence_push('ExpoPushToken[newtoken]', 'en')");
    await db.query('update public.profiles set is_active=false where id=$1', [ids.worker]);
    await db.exec('update public.presence_requests set notification_attempted_at=null');
    assert.equal((await as(null, 'select * from public.claim_presence_notifications()', [], 'service_role')).length, 0, 'suspended employees are not notified');
    // Withdrawal is still allowed while suspended.
    await as(ids.worker, 'select public.set_presence_consent(false)');
    assert.equal((await scalar(ids.worker, 'select public.employee_workspace()')).consent.revoked_at !== null, true);
    assert.equal((await db.query('select * from private.push_tokens')).rows.length, 0);
    assert.equal((await db.query('select * from public.presence_requests where cancelled_at is null and due_at>now()')).rows.length, 0);
    await assert.rejects(as(ids.worker, "select public.declare_task($1,'SAN_WC',1)", [day.id]), /Start a work day/);
    await assert.rejects(as(ids.worker, 'select public.submit_presence_check($1,$2,now(),1,1,10)', [request.id, photo]), /no longer active/);
    const events = await as(ids.worker, 'select * from public.presence_consent_events order by recorded_at');
    assert.deepEqual(events.map(e => e.accepted), [true, false]);
    assert.equal((await as(ids.other, 'select * from public.presence_consent_events')).length, 0);
  });
  await t.test('expired evidence becomes inaccessible and is redacted after file deletion', async () => {
    await db.exec("update public.presence_check_ins set submitted_at=now()-interval '31 days'");
    assert.equal((await as(ids.chef, 'select * from public.presence_check_ins')).length, 0);
    assert.equal((await as(ids.worker, "select * from storage.objects where bucket_id='presence-proofs'")).length, 0);
    const expired = await as(null, 'select * from public.expired_presence_photos()', [], 'service_role');
    assert.equal(expired[0].path, photo);
    assert.equal(await scalar(null, 'select public.redact_expired_presence_evidence()', [], 'service_role'), 0, 'do not lose the path before Storage deletes the file');
    await db.query("delete from storage.objects where bucket_id='presence-proofs' and name=$1", [photo]);
    assert.equal(await scalar(null, 'select public.redact_expired_presence_evidence()', [], 'service_role'), 1);
    const proof = (await db.query('select * from public.presence_check_ins')).rows[0];
    assert.equal(proof.photo_path, null); assert.equal(proof.latitude, null); assert.equal(proof.longitude, null);
    assert.ok(proof.redacted_at); assert.equal(proof.request_id, request.id, 'keep the historical fact that the request was completed');
    assert.equal(await scalar(null, 'select public.redact_expired_presence_evidence()', [], 'service_role'), 0, 'redaction is idempotent');
  });
  await t.test('random schedules remain separated and bounded for all supported durations', async () => {
    const offsets = new Set();
    for (let i = 0; i < 24; i++) {
      const employee = '40000000-0000-0000-0000-' + String(i).padStart(12, '0');
      await db.query('insert into auth.users(id,email) values ($1,$2)', [employee, 'random' + i + '@employee.local']);
      await db.query("insert into public.profiles(id,company_id,first_name,last_name,role) values ($1,$2,'Test','Worker','employee')", [employee, ids.company]);
      await as(employee, 'select public.set_presence_consent(true)');
      const hours = [4, 8, 10][i % 3];
      const work = (await as(employee, 'select * from public.start_work_day($1,$2)', [ids.site, hours]))[0];
      const planned = (await db.query('select * from public.presence_requests where employee_id=$1 order by due_at', [employee])).rows;
      assert.ok(planned.length >= 2 && planned.length <= 3);
      for (let index = 0; index < planned.length; index++) {
        const row = planned[index];
        const delay = +new Date(row.due_at) - +new Date(work.started_at);
        offsets.add(Math.round(delay));
        assert.ok(delay >= 20 * 60_000);
        assert.ok(+new Date(row.expires_at) <= +new Date(work.planned_end_at));
        if (index) assert.ok(+new Date(row.due_at) >= +new Date(planned[index - 1].expires_at));
      }
      await as(employee, 'select public.end_work_day($1)', [work.id]);
      assert.equal((await db.query('select * from public.presence_requests where employee_id=$1 and cancelled_at is null', [employee])).rows.length, 0);
      // A finished day no longer blocks a new one: an employee can move to another
      // site, or head back out after closing early, on the same calendar date.
      const second = (await as(employee, 'select * from public.start_work_day($1,$2)', [ids.site, hours]))[0];
      assert.equal(+new Date(second.work_date), +new Date(work.work_date));
      await as(employee, 'select public.end_work_day($1)', [second.id]);
    }
    assert.ok(offsets.size > 24, 'request times must vary between workers and days');
  });
  await t.test('validated company onboarding still works after direct inserts are revoked', async () => {
    const user = '50000000-0000-0000-0000-000000000001';
    await db.query("insert into auth.users(id,email) values ($1,'new-chef@example.test')", [user]);
    await assert.rejects(as(user, "insert into public.profiles(id,company_id,first_name,last_name,role) values ($1,$2,'Fake','Chef','chef')", [user, ids.company]), /permission denied/);
    const created = (await as(user, "select * from public.create_company_and_chef_profile('New Company','New','Chef')"))[0];
    assert.equal(created.id, user);
    assert.equal(created.role, 'chef');
    assert.notEqual(created.company_id, ids.company);
    assert.equal((await scalar(user, 'select public.chef_dashboard()')).employees, 0);
  });
  await t.test('an employee can delete their own account; declared work survives anonymously', async () => {
    // ids.worker has a work day and a (now redacted) check-in from the tests above,
    // plus a fresh proof so the file list is exercised. ids.other has nothing.
    await db.query("insert into storage.objects(bucket_id,name) values ('avatars',$1)", [ids.worker + '/avatar.jpg']);
    await db.query("insert into private.push_tokens(token,employee_id) values ('ExpoPushToken[worker]',$1)", [ids.worker]);
    const before = await scalar(ids.chef, 'select public.chef_dashboard()');
    await assert.rejects(as(null, 'select public.delete_own_account()', [], 'anon'), /permission denied/);
    const result = await scalar(ids.worker, 'select public.delete_own_account()');
    assert.deepEqual(result.files, [{ bucket: 'avatars', path: ids.worker + '/avatar.jpg' }]);
    assert.equal((await db.query('select * from auth.users where id=$1', [ids.worker])).rows.length, 0, 'sign-in is gone');
    const tombstone = (await db.query('select * from public.profiles where id=$1', [ids.worker])).rows[0];
    assert.ok(tombstone.deleted_at, 'profile stays because work was declared under it');
    assert.equal(tombstone.first_name, 'Compte supprimé'); assert.equal(tombstone.last_name, '');
    assert.equal(tombstone.username, null); assert.equal(tombstone.phone, null); assert.equal(tombstone.is_active, false);
    assert.equal((await db.query('select * from private.push_tokens where employee_id=$1', [ids.worker])).rows.length, 0);
    assert.equal((await db.query('select * from public.work_days where employee_id=$1', [ids.worker])).rows.length > 0, true, 'company records remain');
    assert.equal((await db.query('select * from public.work_days where employee_id=$1 and ended_at is null', [ids.worker])).rows.length, 0);
    assert.equal((await db.query('select * from public.presence_check_ins where employee_id=$1 and redacted_at is null', [ids.worker])).rows.length, 0, 'evidence redacted immediately');
    assert.equal((await scalar(ids.chef, 'select public.chef_dashboard()')).employees, before.employees - 1, 'tombstones are not headcount');
    await assert.rejects(as(ids.worker, 'select public.delete_own_account()'), /already deleted/);
    // No declared work: nothing to keep, the profile goes entirely.
    await as(ids.other, 'select public.delete_own_account()');
    assert.equal((await db.query('select * from public.profiles where id=$1', [ids.other])).rows.length, 0);
  });
  await t.test('a chef deleting their account removes the company and its employees', async () => {
    const chef = '60000000-0000-0000-0000-000000000001', staff = '60000000-0000-0000-0000-000000000002';
    await db.query("insert into auth.users(id,email) values ($1,'gone-chef@example.test'), ($2,'gone-staff@employee.local')", [chef, staff]);
    const company = (await as(chef, "select * from public.create_company_and_chef_profile('Gone Ltd','Gone','Chef')"))[0].company_id;
    await db.query("insert into public.profiles(id,company_id,first_name,last_name,role) values ($1,$2,'Gone','Staff','employee')", [staff, company]);
    await db.query("insert into public.sites(company_id,name,address,latitude,longitude) values ($1,'Gone site','3 rue C, Fès',34.03,-5.0)", [company]);
    await db.query("insert into storage.objects(bucket_id,name) values ('avatars',$1)", [staff + '/avatar.jpg']);
    const site = (await db.query('select id from public.sites where company_id=$1', [company])).rows[0].id;
    await as(staff, 'select public.set_presence_consent(true)');
    await as(staff, 'select * from public.start_work_day($1, 8)', [site]);
    const result = await scalar(chef, 'select public.delete_own_account()');
    assert.deepEqual(result.files, [{ bucket: 'avatars', path: staff + '/avatar.jpg' }]);
    for (const [table, column] of [['public.companies', 'id'], ['public.sites', 'company_id'], ['public.work_days', 'company_id'], ['public.presence_requests', 'company_id']]) {
      assert.equal((await db.query(`select * from ${table} where ${column}=$1`, [company])).rows.length, 0, table);
    }
    assert.equal((await db.query('select * from public.profiles where id in ($1,$2)', [chef, staff])).rows.length, 0);
    assert.equal((await db.query('select * from auth.users where id in ($1,$2)', [chef, staff])).rows.length, 0);
    assert.equal((await db.query('select * from public.presence_consents where employee_id=$1', [staff])).rows.length, 0);
  });
  await t.test('planning is written by the chef on the web and read by employees once sent', async () => {
    // Fresh company: earlier tests deleted the fixture employees of both companies.
    const chefB = '70000000-0000-0000-0000-000000000001', staffB = '70000000-0000-0000-0000-000000000002';
    await db.query("insert into auth.users(id,email) values ($1,'plan-chef@example.test'), ($2,'plan-staff@employee.local')", [chefB, staffB]);
    const companyB = (await as(chefB, "select * from public.create_company_and_chef_profile('Planning Ltd','Plan','Chef')"))[0].company_id;
    await db.query("insert into public.profiles(id,company_id,first_name,last_name,role) values ($1,$2,'Plan','Staff','employee')", [staffB, companyB]);
    const siteB = (await db.query("insert into public.sites(company_id,name,address,latitude,longitude) values ($1,'Plan site','4 rue D, Tanger',35.76,-5.83) returning id", [companyB])).rows[0].id;
    const shift = (employee, date, start = '08:00', end = '17:00') =>
      as(chefB, "insert into public.planned_shifts(company_id, employee_id, site_id, work_date, start_time, end_time, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [companyB, employee, siteB, date, start, end, chefB]);
    // Employees cannot write; a chef cannot schedule someone from another company or on a foreign site.
    await assert.rejects(as(staffB, "insert into public.planned_shifts(company_id, employee_id, site_id, work_date, start_time, end_time, created_by) values ($1,$2,$3,'2026-09-21','08:00','17:00',$2)", [companyB, staffB, siteB]), /row-level security/);
    await assert.rejects(as(chefB, "insert into public.planned_shifts(company_id, employee_id, site_id, work_date, start_time, end_time, created_by) values ($1,$2,$3,'2026-09-21','08:00','17:00',$4)", [companyB, ids.chef, siteB, chefB]), /row-level security/);
    await assert.rejects(as(chefB, "insert into public.planned_shifts(company_id, employee_id, site_id, work_date, start_time, end_time, created_by) values ($1,$2,$3,'2026-09-21','08:00','17:00',$4)", [companyB, staffB, ids.site, chefB]), /row-level security/);
    await assert.rejects(shift(staffB, '2026-09-21', '17:00', '08:00'), /check constraint/);
    const [{ id }] = await shift(staffB, '2026-09-21');
    await shift(chefB, '2026-09-21', '07:30', '12:00');
    // Not sent yet: invisible to the employee, visible to the chef.
    assert.equal((await as(staffB, 'select * from public.planned_shifts')).length, 0);
    assert.equal((await as(chefB, 'select * from public.planned_shifts')).length, 2);
    await assert.rejects(as(staffB, "select public.publish_planning('2026-09-21','2026-09-27')"), /Chef account required/);
    await assert.rejects(as(chefB, "select public.publish_planning('2026-10-05','2026-10-11')"), /Nothing to send/);
    const sent = await scalar(chefB, "select public.publish_planning('2026-09-21','2026-09-27')");
    assert.equal(sent.shifts, 2);
    assert.deepEqual(new Set(sent.employees), new Set([staffB, chefB]));
    assert.equal((await as(staffB, 'select * from public.planned_shifts')).length, 1, 'employee sees only their own sent shift');
    assert.equal((await as(chefB, 'select * from public.planning_sends')).length, 1);
    assert.equal((await as(ids.chef, 'select * from public.planning_sends')).length, 0, 'sends are company-private');
    // Editing after a send hides the shift again until the next send.
    await as(chefB, "update public.planned_shifts set end_time = '18:00' where id = $1", [id]);
    assert.equal((await as(staffB, 'select * from public.planned_shifts')).length, 0);
    assert.equal((await db.query('select published_at from public.planned_shifts where id=$1', [id])).rows[0].published_at, null);
    // Push targets are service-only and respect the employee's notification switch.
    await assert.rejects(as(chefB, 'select * from public.planning_push_targets($1)', [[staffB]]), /permission denied/);
    await db.query("insert into private.push_tokens(token, employee_id) values ('ExpoPushToken[staffB]', $1)", [staffB]);
    assert.equal((await as(null, 'select * from public.planning_push_targets($1)', [[staffB, chefB]], 'service_role')).length, 1);
    await db.query('update public.profiles set notifications_enabled = false where id = $1', [staffB]);
    assert.equal((await as(null, 'select * from public.planning_push_targets($1)', [[staffB]], 'service_role')).length, 0);
    await db.query('update public.profiles set notifications_enabled = true where id = $1', [staffB]);
  });
  await t.test('an account abandoned at onboarding can still delete itself', async () => {
    const stranded = '80000000-0000-0000-0000-000000000001';
    await db.query("insert into auth.users(id,email) values ($1,'stranded@example.test')", [stranded]);
    assert.equal((await as(stranded, 'select public.delete_own_account()'))[0].delete_own_account.files.length, 0);
    assert.equal((await db.query('select * from auth.users where id=$1', [stranded])).rows.length, 0);
    await assert.rejects(as(null, 'select public.delete_own_account()', [], 'anon'), /permission denied/);
  });
});
