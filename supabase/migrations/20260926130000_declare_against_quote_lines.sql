-- A devis line is a thing to do; a catalogue code is only a convenient way of
-- grouping similar things across chantiers. Requiring a code to measure
-- progress made the catalogue load-bearing, and a line the catalogue had no
-- word for became invisible — which is most of a real devis the first time
-- you import one.
--
-- So a declaration may now point at a quote line directly. The code stays for
-- work declared without a devis (the way the app works today) and as a
-- shortcut when a line happens to match one, but it is no longer the only way
-- to count what has been done.

alter table public.task_declarations
  add column quote_line_id uuid references public.quote_lines(id) on delete set null,
  alter column task_code drop not null,
  add constraint task_declarations_target_present
    check (task_code is not null or quote_line_id is not null);

create index task_declarations_quote_line_idx
  on public.task_declarations (quote_line_id)
  where quote_line_id is not null;

grant insert (work_day_id, employee_id, company_id, site_id, task_code, quote_line_id, quantity)
  on public.task_declarations to authenticated;

/**
 * What has been declared against each line of a devis.
 *
 * Only declarations attached to the line itself are counted. Code-based
 * declarations are deliberately not folded in: several lines of one devis can
 * share a code (four DRV indoor units of different powers), and splitting a
 * quantity between them would be a guess presented as a measurement.
 */
create or replace function public.quote_progress(quote uuid)
returns table (
  line_id uuid,
  quoted numeric,
  declared numeric,
  remaining numeric,
  amount_ht numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.quantity,
    coalesce(sum(d.quantity), 0),
    case when l.quantity is null then null else l.quantity - coalesce(sum(d.quantity), 0) end,
    l.amount_ht
  from public.quote_lines l
  left join public.task_declarations d on d.quote_line_id = l.id
  join public.site_quotes q on q.id = l.quote_id
  where l.quote_id = quote
    and l.kind = 'work'
    and q.company_id = public.current_profile_company_id()
  group by l.id, l.quantity, l.amount_ht
  order by min(l.position);
$$;

revoke all on function public.quote_progress(uuid) from public, anon;
grant execute on function public.quote_progress(uuid) to authenticated;
