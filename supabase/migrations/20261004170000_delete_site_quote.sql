-- Deleting a devis, and saying no when it cannot be deleted.
--
-- Deleting one went straight at the table. Where nothing had been worked it
-- succeeded; where a crew had declared against its lines the database refused
-- — the declaration points at either a catalogue code or a devis line, and
-- cascading the delete left it pointing at neither. The refusal was right.
-- What reached the chef was "impossible de charger les données", which is
-- what the screen says when anything at all goes wrong.
--
-- So the rule is stated where it belongs, with the reason. A devis that has
-- been worked on is not deleted: those quantities are somebody's day and
-- somebody's pay, and they would be left pointing at nothing. The trade
-- already has the answer the app supports — a devis that is no longer the one
-- in force is replaced by its successor, which keeps what was declared
-- against it.
create or replace function public.delete_site_quote(quote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.site_quotes;
  declared integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then
    raise exception 'Only a chef can delete a devis';
  end if;

  select * into target from public.site_quotes where id = quote for update;
  if not found or target.company_id <> me.company_id then
    raise exception 'Quote not found';
  end if;

  select count(*) into declared
  from public.task_declarations d
  join public.quote_lines l on l.id = d.quote_line_id
  where l.quote_id = quote;
  if declared > 0 then
    raise exception 'Work has already been declared against that devis';
  end if;

  if exists (
    select 1 from public.quote_line_steps st
    join public.quote_lines l on l.id = st.quote_line_id
    where l.quote_id = quote and st.done_at is not null
  ) then
    raise exception 'Work has already been declared against that devis';
  end if;

  delete from public.site_quotes where id = quote;
end $$;

revoke all on function public.delete_site_quote(uuid) from public, anon;
grant execute on function public.delete_site_quote(uuid) to authenticated;
