-- Folding accents needed the unaccent extension, which is not available in
-- every Postgres the migrations are replayed into — the database contract
-- test builds a bare instance and stopped dead on it. The handful of accented
-- characters that occur in a French devis do not justify an extension
-- dependency, so the fold is written out.

create or replace function public.fold_label(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(trim(translate(
    -- The printed numbering ("12- ", "a- ") and parenthetical asides
    -- ("(PRIX POUR MÉMOIRE)") are not part of what the line is.
    regexp_replace(
      regexp_replace(coalesce(value, ''), '^\s*[0-9]+\s*-\s*|^\s*[a-z]\s*-\s*', '', 'i'),
      '\s*\([^)]*\)\s*', ' ', 'g'),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
  )))
$$;

grant execute on function public.fold_label(text) to authenticated, service_role;

create or replace function public.record_quote_candidates(quote uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  company uuid;
  affected integer;
begin
  select company_id into company from public.site_quotes where id = quote;
  if company is null then return 0; end if;

  if auth.uid() is not null then
    if public.current_profile_role() <> 'chef'
       or company <> public.current_profile_company_id() then
      raise exception 'Only a chef of the company may record candidates';
    end if;
  end if;

  with unmatched as (
    select distinct on (normalised)
      public.fold_label(coalesce(nullif(l.candidate_label, ''), l.label)) as normalised,
      coalesce(nullif(l.candidate_label, ''), l.label) as sample_label,
      l.unit
    from public.quote_lines l
    where l.quote_id = quote and l.kind = 'work' and l.task_code is null
  )
  insert into public.task_code_candidates (company_id, normalised, sample_label, unit, occurrences)
  select company, u.normalised, u.sample_label, u.unit, 1
  from unmatched u
  where length(u.normalised) between 3 and 200
  on conflict (company_id, normalised) do update
    set occurrences = public.task_code_candidates.occurrences + 1,
        last_seen = now(),
        unit = coalesce(public.task_code_candidates.unit, excluded.unit);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.record_quote_candidates(uuid) to authenticated, service_role;

create or replace function public.promote_task_code_candidate(
  candidate uuid,
  new_code text,
  label text,
  code_unit text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.task_code_candidates;
begin
  select * into row from public.task_code_candidates where id = candidate;
  if row is null then raise exception 'Candidate not found'; end if;
  if public.current_profile_role() <> 'chef'
     or row.company_id <> public.current_profile_company_id() then
    raise exception 'Only a chef of the company may promote a candidate';
  end if;
  if new_code !~ '^[A-Z][A-Z0-9_]{2,29}$' then
    raise exception 'A code is 3 to 30 characters, upper case, digits and underscores';
  end if;
  if code_unit not in ('m', 'm2', 'm3', 'unit', 'kg') then
    raise exception 'Unknown unit';
  end if;

  insert into public.task_codes (code, category_code, label_fr, label_en, unit, sort_order, is_active)
  values (new_code, 'plumbing_hvac', label, label, code_unit,
          coalesce((select max(sort_order) + 1 from public.task_codes), 1), true)
  on conflict (code) do nothing;

  update public.task_code_candidates
    set status = 'accepted', created_code = new_code
    where id = candidate;

  update public.quote_lines l
    set task_code = new_code
    from public.site_quotes q
    where l.quote_id = q.id
      and q.company_id = row.company_id
      and l.task_code is null
      and public.fold_label(coalesce(nullif(l.candidate_label, ''), l.label)) = row.normalised;

  return new_code;
end;
$$;

grant execute on function public.promote_task_code_candidate(uuid, text, text, text) to authenticated;
