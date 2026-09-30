-- record_quote_candidates is called two ways: by the parser, which runs with
-- the service role and has no auth.uid(), and potentially by a chef's own
-- client. The chef check must therefore apply only when there is a caller to
-- check — with no JWT the call can only have come from our own backend.

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
      lower(extensions.unaccent(trim(regexp_replace(
        regexp_replace(coalesce(nullif(l.candidate_label, ''), l.label), '^\s*[0-9]+\s*-\s*|^\s*[a-z]\s*-\s*', '', 'i'),
        '\s*\([^)]*\)\s*', ' ', 'g')))) as normalised,
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

grant execute on function public.record_quote_candidates(uuid) to service_role;
