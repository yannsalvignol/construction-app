-- Two devis on one chantier: which one is the work?
--
-- Until now the app answered "both", silently. day_quote_lines joins every
-- validated quote of the site, so a corrected devis imported next to the one it
-- corrects doubled the métré sold, and nobody was asked. The chef's progress
-- screen meanwhile grouped by quote and showed two bars, so the two screens
-- told different stories about the same chantier.
--
-- The four real cases look alike and end differently: a revision the client
-- negotiated, an avenant for extra work, two trades quoted separately, and the
-- same file imported twice. A revision and an avenant on the same lot are
-- nearly identical in content and opposite in consequence — which is why this
-- is asked rather than guessed. The chef knows; we do not.

alter table public.site_quotes
  add column if not exists supersedes_quote_id uuid references public.site_quotes(id) on delete set null;

-- A replaced devis is not deleted: it is what was sold before, and the
-- declarations made against it are real work. It simply stops being the target.
alter table public.site_quotes drop constraint if exists site_quotes_status_check;
alter table public.site_quotes add constraint site_quotes_status_check
  check (status = any (array['stored', 'parsing', 'parsed', 'validated', 'superseded', 'failed']));

/**
 * Validates a devis, and says what it does to the one already in force.
 *
 * `supersedes` null is an avenant: both stand, and the chantier's work is the
 * sum. Passing the earlier quote's id replaces it.
 *
 * A devis can only be replaced while nothing has been declared against it.
 * Once the chantier has run, the declarations point at lines that the new
 * version may not have, and matching lines across two readings of a document is
 * a guess dressed as a fact. The trade already has an answer for this: you do
 * not rewrite a devis that has been worked on, you add an avenant for the
 * difference.
 */
create or replace function public.validate_quote(quote uuid, supersedes uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.site_quotes;
  earlier public.site_quotes;
  declared integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then raise exception 'Only a chef can validate a devis'; end if;

  select * into target from public.site_quotes where id = quote for update;
  if not found or target.company_id <> me.company_id then
    raise exception 'Quote not found';
  end if;
  if target.status not in ('parsed', 'validated') then
    raise exception 'This devis has not been read yet';
  end if;

  if supersedes is not null then
    select * into earlier from public.site_quotes where id = supersedes for update;
    if not found or earlier.company_id <> me.company_id or earlier.site_id <> target.site_id then
      raise exception 'That devis does not belong to this chantier';
    end if;
    if earlier.id = target.id then raise exception 'A devis cannot replace itself'; end if;

    select count(*) into declared
    from public.task_declarations t
    join public.quote_lines l on l.id = t.quote_line_id
    where l.quote_id = earlier.id;
    if declared > 0 then
      raise exception 'Work has already been declared against that devis; add an avenant instead';
    end if;

    update public.site_quotes set status = 'superseded' where id = earlier.id;
  end if;

  update public.site_quotes
    set status = 'validated', supersedes_quote_id = supersedes
    where id = target.id;
end $$;

revoke all on function public.validate_quote(uuid, uuid) from public, anon;
grant execute on function public.validate_quote(uuid, uuid) to authenticated;

/**
 * The devis already in force on this one's chantier, if any, and whether it can
 * still be replaced. Read when a second devis is validated, so the question is
 * only asked when there is something to ask about.
 */
create or replace function public.quote_in_force(quote uuid)
returns table (other_id uuid, file_name text, total_ht numeric, replaceable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.file_name, q.total_ht,
    not exists (
      select 1 from public.task_declarations t
      join public.quote_lines l on l.id = t.quote_line_id
      where l.quote_id = q.id
    )
  from public.site_quotes mine
  join public.site_quotes q
    on q.site_id = mine.site_id and q.company_id = mine.company_id
   and q.status = 'validated' and q.id <> mine.id
  where mine.id = quote
    and mine.company_id = public.current_profile_company_id()
  order by q.created_at desc;
$$;

revoke all on function public.quote_in_force(uuid) from public, anon;
grant execute on function public.quote_in_force(uuid) to authenticated;
