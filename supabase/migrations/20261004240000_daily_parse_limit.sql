-- A ceiling on how many devis a company may have read in a day.
--
-- Reading a devis is the one thing in this app that costs real money per use:
-- a ten-page scan is a hundred and fourteen thousand input tokens, read page
-- by page, and nothing stops a chef from importing the same document forty
-- times to see if it comes out better. There is no malice needed for that —
-- a parse that disappoints invites a retry, and a retry costs the same as the
-- first one.
--
-- Per company, because the company is what pays, and attempts rather than
-- successes, because a reading that fails has already spent the tokens. The
-- limit is a column so it can be raised for a customer who genuinely imports
-- twenty devis in a morning, without a deploy.
alter table public.companies
  add column if not exists daily_parse_limit integer not null default 5
    check (daily_parse_limit >= 0);

/**
 * Claims one of today's readings, or refuses.
 *
 * The claim and the count are one statement so two devis sent at the same
 * instant cannot both see four used and both proceed. Counted over the
 * company's own calendar day, not a rolling 24 hours: "five a day" should mean
 * what a chef thinks it means, and reset when his morning does.
 */
create or replace function public.claim_quote_parse(quote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.site_quotes;
  tz text;
  used integer;
  allowed integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null or me.role <> 'chef' then
    raise exception 'Only a chef can import a devis';
  end if;

  select * into target from public.site_quotes where id = quote for update;
  if not found or target.company_id <> me.company_id then
    raise exception 'Quote not found';
  end if;

  select c.time_zone, c.daily_parse_limit into tz, allowed
  from public.companies c where c.id = me.company_id;

  -- Locked for the duration so simultaneous imports queue behind each other
  -- rather than both reading the same count.
  perform 1 from public.companies where id = me.company_id for update;

  select count(*) into used
  from public.site_quotes q
  where q.company_id = me.company_id
    and q.parsing_started_at is not null
    and (q.parsing_started_at at time zone coalesce(tz, 'UTC'))::date
        = (now() at time zone coalesce(tz, 'UTC'))::date
    -- A devis already counted today is not counted twice when the chef
    -- retries it: the rule is about how many documents are read, and one
    -- document re-read is the same document.
    and q.id <> quote;

  if allowed > 0 and used >= allowed then
    -- Fixed wording, no number interpolated: the client translates server
    -- messages by matching them exactly, and a sentence that carries a figure
    -- would reach the chef in English. The figure is on his screen already.
    raise exception 'Daily devis reading limit reached';
  end if;

  update public.site_quotes
     set status = 'parsing',
         parse_error = null,
         parse_warning = null,
         parse_stage = null,
         parsing_started_at = now()
   where id = quote;
end $$;

revoke all on function public.claim_quote_parse(uuid) from public, anon;
grant execute on function public.claim_quote_parse(uuid) to authenticated;

/** What is left today, for the screen that imports them. */
create or replace function public.quote_parses_left()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    (select c.daily_parse_limit from public.companies c
      where c.id = public.current_profile_company_id())
    - (select count(*)::integer
       from public.site_quotes q
       join public.companies c on c.id = q.company_id
       where q.company_id = public.current_profile_company_id()
         and q.parsing_started_at is not null
         and (q.parsing_started_at at time zone coalesce(c.time_zone, 'UTC'))::date
             = (now() at time zone coalesce(c.time_zone, 'UTC'))::date)
  )
$$;
revoke all on function public.quote_parses_left() from public, anon;
grant execute on function public.quote_parses_left() to authenticated;
