-- A word from the chef to whoever is on a chantier.
--
-- Until now everything travelled the other way: the employee declares, the
-- chef reads. "Le ciment arrive à 7h", "entrée par la rue de derrière demain",
-- "casque obligatoire, le client passe" had nowhere to go but WhatsApp, which
-- is where half of a chantier's instructions already live and where none of
-- them can be found again.
--
-- Addressed to a chantier rather than to people, because that is how the work
-- is organised: whoever is there should read it, and somebody added to the
-- chantier tomorrow should read it too, without the chef remembering to
-- forward anything.
create table public.site_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  -- Kept when the chef's account goes, so the note does not vanish with him.
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index site_notes_by_site on public.site_notes (site_id, created_at desc);

alter table public.site_notes enable row level security;

/**
 * Whether an employee is "on" a chantier for the purpose of reading its notes.
 *
 * Two ways in, because a chantier has a past and a future: a published shift
 * there from today onwards — the man who has not started yet but is expected
 * — and a declared day there in the last month — the man who is working it,
 * and who should not lose yesterday's instruction because today has not begun.
 *
 * Deliberately not "is on site right now". An instruction that is only
 * readable while standing on the chantier is an instruction nobody reads on
 * the bus on the way there.
 */
create or replace function public.employee_on_site(employee uuid, site uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.planned_shifts s
     where s.employee_id = employee and s.site_id = site
       and s.published_at is not null
       and s.work_date >= (now() at time zone coalesce(
             (select c.time_zone from public.companies c
               join public.profiles p on p.company_id = c.id where p.id = employee), 'UTC'))::date
  ) or exists (
    select 1 from public.work_days d
     where d.employee_id = employee and d.site_id = site
       and d.started_at > now() - interval '30 days'
  );
$$;
revoke all on function public.employee_on_site(uuid, uuid) from public, anon;
grant execute on function public.employee_on_site(uuid, uuid) to authenticated;

-- The chef sees every note his company has written; an employee sees the ones
-- for the chantiers he is on. Enforced here and not only in the two functions
-- below, because a policy is what holds when somebody queries the table
-- directly with the anon key rather than through the app.
-- Reading only. Writing goes through post_site_note, which is the one place
-- that knows a note may not be addressed to another company's chantier.
grant select on public.site_notes to authenticated;

create policy site_notes_read on public.site_notes for select to authenticated using (
  company_id = public.current_profile_company_id()
  and (public.current_profile_role() = 'chef'
       or public.employee_on_site(auth.uid(), site_id))
);

/** Writes a note. Chef only, and not while the company is locked. */
create or replace function public.post_site_note(site uuid, body text)
returns public.site_notes language plpgsql security definer set search_path = '' as $$
declare me public.profiles; note public.site_notes;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then raise exception 'Chef account required'; end if;
  perform public.require_company_access();
  if not exists (select 1 from public.sites s where s.id = site and s.company_id = me.company_id) then
    raise exception 'Site not found';
  end if;
  if body is null or length(btrim(body)) = 0 then raise exception 'Write something first'; end if;
  insert into public.site_notes(company_id, site_id, author_id, body)
  values (me.company_id, site, me.id, btrim(body))
  returning * into note;
  return note;
end $$;
revoke all on function public.post_site_note(uuid, text) from public, anon;
grant execute on function public.post_site_note(uuid, text) to authenticated;

/** Takes a note back. Chef only, and only his own company's. */
create or replace function public.delete_site_note(note uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then raise exception 'Chef account required'; end if;
  delete from public.site_notes n where n.id = note and n.company_id = me.company_id;
end $$;
revoke all on function public.delete_site_note(uuid) from public, anon;
grant execute on function public.delete_site_note(uuid) to authenticated;

/**
 * What the employee's Instructions tab shows: every note for every chantier he
 * is on, newest first, each carrying the chantier it belongs to so he can tell
 * two of them apart.
 */
create or replace function public.my_site_notes()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; result jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'employee' then raise exception 'Employee account required'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into result from (
    select n.id, n.body, n.created_at, s.name as site_name,
           coalesce(p.first_name || ' ' || p.last_name, '') as author_name
      from public.site_notes n
      join public.sites s on s.id = n.site_id
      left join public.profiles p on p.id = n.author_id
     where n.company_id = me.company_id
       and public.employee_on_site(me.id, n.site_id)
     limit 100
  ) t;
  return result;
end $$;
revoke all on function public.my_site_notes() from public, anon;
grant execute on function public.my_site_notes() to authenticated;

/** The chef's side of the same list, for one chantier. */
create or replace function public.site_notes(site uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; result jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then raise exception 'Chef account required'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into result from (
    select n.id, n.body, n.created_at
      from public.site_notes n
     where n.site_id = site and n.company_id = me.company_id
     limit 50
  ) t;
  return result;
end $$;
revoke all on function public.site_notes(uuid) from public, anon;
grant execute on function public.site_notes(uuid) to authenticated;

/**
 * The phones to ring when a note is posted: the same audience that may read
 * it, minus anyone who has switched notifications off or whose account is
 * closed. Service role only, like the planning's equivalent — a token is the
 * ability to send somebody a notification, and no client needs one.
 */
create or replace function public.site_note_push_targets(site uuid)
returns table(token text, locale text, employee_id uuid)
language sql security definer set search_path = '' as $$
  select t.token, t.locale, t.employee_id
    from private.push_tokens t
    join public.profiles p on p.id = t.employee_id
   where p.is_active and p.notifications_enabled and p.deleted_at is null
     and public.employee_on_site(p.id, site);
$$;
revoke all on function public.site_note_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.site_note_push_targets(uuid) to service_role;
