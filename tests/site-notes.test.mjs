import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * Notes addressed to a chantier, against real PostgreSQL.
 *
 * What matters here is who can read one. A note is written for the men on a
 * chantier, which is a question the database has to answer the same way every
 * time — the screen asking politely is not a boundary.
 */
const db = new PGlite();
const ids = {
  chef: '10000000-0000-0000-0000-000000000001',
  onSite: '10000000-0000-0000-0000-000000000002',
  elsewhere: '10000000-0000-0000-0000-000000000003',
  planned: '10000000-0000-0000-0000-000000000004',
  otherChef: '10000000-0000-0000-0000-000000000005',
  company: '20000000-0000-0000-0000-000000000001',
  otherCompany: '20000000-0000-0000-0000-000000000002',
  site: '30000000-0000-0000-0000-000000000001',
  otherSite: '30000000-0000-0000-0000-000000000002',
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

test('notes on a chantier', async t => {
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
    insert into auth.users values ('${ids.chef}','chef@example.test'),('${ids.onSite}','a@employee.local'),
      ('${ids.elsewhere}','b@employee.local'),('${ids.planned}','c@employee.local'),('${ids.otherChef}','d@example.test');
    insert into public.companies(id,name) values ('${ids.company}','A'),('${ids.otherCompany}','B');
    insert into public.profiles(id,company_id,first_name,last_name,role) values
      ('${ids.chef}','${ids.company}','Chef','A','chef'),
      ('${ids.onSite}','${ids.company}','Sur','Place','employee'),
      ('${ids.elsewhere}','${ids.company}','Autre','Chantier','employee'),
      ('${ids.planned}','${ids.company}','Prevu','Demain','employee'),
      ('${ids.otherChef}','${ids.otherCompany}','Chef','B','chef');
    insert into public.sites(id,company_id,name,address,latitude,longitude) values
      ('${ids.site}','${ids.company}','Chantier A','1 rue A, Casablanca',33.5731,-7.5898),
      ('${ids.otherSite}','${ids.company}','Chantier B','2 rue B, Casablanca',33.5831,-7.5998);
    -- One man has worked here, one has worked elsewhere, one is only planned.
    insert into public.work_days(employee_id,company_id,site_id,work_date,planned_end_at) values
      ('${ids.onSite}','${ids.company}','${ids.site}', current_date, now() + interval '4 hours'),
      ('${ids.elsewhere}','${ids.company}','${ids.otherSite}', current_date, now() + interval '4 hours');
    insert into public.planned_shifts(company_id,employee_id,site_id,work_date,start_time,end_time,published_at) values
      ('${ids.company}','${ids.planned}','${ids.site}', current_date + 1, '08:00', '17:00', now());
  `);

  await t.test('a chef writes to a chantier and the men on it read it', async () => {
    await as(ids.chef, 'select public.post_site_note($1, $2)', [ids.site, '  Le ciment arrive à 7h  ']);
    const mine = await as(ids.onSite, 'select public.my_site_notes() as n');
    assert.equal(mine[0].n.length, 1);
    // Trimmed on the way in, and it says which chantier it is about.
    assert.equal(mine[0].n[0].body, 'Le ciment arrive à 7h');
    assert.equal(mine[0].n[0].site_name, 'Chantier A');
    assert.equal(mine[0].n[0].author_name, 'Chef A');
  });

  await t.test('a man planned there tomorrow reads it before he arrives', async () => {
    const soon = await as(ids.planned, 'select public.my_site_notes() as n');
    assert.equal(soon[0].n.length, 1);
  });

  await t.test('a man on another chantier does not', async () => {
    const other = await as(ids.elsewhere, 'select public.my_site_notes() as n');
    assert.equal(other[0].n.length, 0);
    // And not by reading the table directly either, which is the boundary
    // that holds when the query does not come from our screen.
    assert.equal((await as(ids.elsewhere, 'select * from public.site_notes')).length, 0);
    assert.equal((await as(ids.onSite, 'select * from public.site_notes')).length, 1);
  });

  await t.test('nobody writes to a chantier that is not theirs', async () => {
    await assert.rejects(as(ids.onSite, 'select public.post_site_note($1, $2)', [ids.site, 'x']), /Chef account required/);
    await assert.rejects(as(ids.otherChef, 'select public.post_site_note($1, $2)', [ids.site, 'x']), /Site not found/);
    await assert.rejects(as(ids.chef, 'select public.post_site_note($1, $2)', [ids.site, '   ']), /Write something/);
    assert.equal((await as(ids.otherChef, 'select * from public.site_notes')).length, 0);
  });

  await t.test('a locked company writes nothing', async () => {
    await peek(`update public.companies set subscription_active = false,
                trial_started_at = now() - interval '60 days' where id = $1`, [ids.company]);
    await assert.rejects(as(ids.chef, 'select public.post_site_note($1, $2)', [ids.site, 'x']), /needs to be unlocked/);
    await peek('update public.companies set subscription_active = true where id = $1', [ids.company]);
  });

  await t.test('a note is taken back, and only by its own company', async () => {
    const note = (await as(ids.chef, 'select public.site_notes($1) as n', [ids.site]))[0].n[0];
    await as(ids.otherChef, 'select public.delete_site_note($1)', [note.id]);
    assert.equal((await as(ids.chef, 'select public.site_notes($1) as n', [ids.site]))[0].n.length, 1);
    await as(ids.chef, 'select public.delete_site_note($1)', [note.id]);
    assert.equal((await as(ids.chef, 'select public.site_notes($1) as n', [ids.site]))[0].n.length, 0);
  });

  await t.test('a day worked long ago stops carrying the chantier', async () => {
    await as(ids.chef, 'select public.post_site_note($1, $2)', [ids.site, 'Casque obligatoire']);
    assert.equal((await as(ids.onSite, 'select public.my_site_notes() as n'))[0].n.length, 1);
    await peek(`update public.work_days set started_at = now() - interval '40 days' where employee_id = $1`, [ids.onSite]);
    assert.equal((await as(ids.onSite, 'select public.my_site_notes() as n'))[0].n.length, 0);
  });
});
