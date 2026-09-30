-- What each chantier's validated devis says, and how much of it is declared
-- done. One call for the dashboard rather than one per chantier.
--
-- Weighted by money, not by line count: ten lines of robinetterie are not
-- worth one chape, and a chef reading a single percentage is reading a
-- financial position whether or not he says so.
--
-- Only validated devis count. A devis still being checked has unverified
-- quantities in it, and a percentage built on those would be a guess wearing
-- the clothes of a measurement.

create or replace function public.site_quote_progress()
returns table (
  site_id uuid,
  quote_id uuid,
  lines integer,
  measurable integer,
  quoted_amount numeric,
  done_amount numeric,
  percent integer
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select
      q.site_id,
      q.id as quote_id,
      l.id as line_id,
      l.amount_ht,
      l.quantity,
      coalesce((
        select sum(d.quantity)
        from public.task_declarations d
        where d.quote_line_id = l.id
      ), 0) as declared
    from public.site_quotes q
    join public.quote_lines l on l.quote_id = q.id
    where q.company_id = public.current_profile_company_id()
      and q.status = 'validated'
      and l.kind = 'work'
  )
  select
    site_id,
    quote_id,
    count(*)::integer,
    -- A line with no quantity can be listed but not measured.
    count(*) filter (where quantity is not null and quantity > 0)::integer,
    coalesce(sum(amount_ht), 0),
    coalesce(sum(
      case
        when quantity is null or quantity <= 0 then 0
        -- Capped: declaring more than was quoted is rework or waste, not
        -- progress beyond the contract.
        else coalesce(amount_ht, 0) * least(declared / quantity, 1)
      end
    ), 0),
    case
      when coalesce(sum(amount_ht) filter (where quantity is not null and quantity > 0), 0) = 0 then 0
      else round(
        100 * sum(
          case when quantity is null or quantity <= 0 then 0
               else coalesce(amount_ht, 0) * least(declared / quantity, 1) end
        ) / sum(coalesce(amount_ht, 0)) filter (where quantity is not null and quantity > 0)
      )::integer
    end
  from lines
  group by site_id, quote_id;
$$;

revoke all on function public.site_quote_progress() from public, anon;
grant execute on function public.site_quote_progress() to authenticated;
