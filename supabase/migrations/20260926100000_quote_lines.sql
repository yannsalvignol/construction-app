-- The parsed contents of a devis: what was quoted, so declared work can be
-- measured against it (docs/DEVIS_AVANCEMENT.md).
--
-- Lines are written by the parser and are NOT trusted until a chef has been
-- through them: `site_quotes.status` moves parsing -> parsed -> validated, and
-- nothing on a dashboard reads a quote that is not validated. Extraction from
-- a clean PDF is close to solved; from a photograph of an annotated paper
-- devis it is not, and a wrong quantity silently poisons every percentage
-- derived from it.

alter table public.site_quotes
  add column status text not null default 'stored'
    check (status in ('stored', 'parsing', 'parsed', 'validated', 'failed')),
  add column parsed_at timestamptz,
  add column parse_error text,
  -- Totals as the devis states them, for a sanity check against the sum of
  -- the lines: if they disagree, something was missed.
  add column total_ht numeric(14, 2),
  add column currency text not null default 'MAD';

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.site_quotes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Order as printed, so the review screen can be read next to the paper.
  position integer not null,
  -- The lot heading the line sits under ("PLOMBERIE-SANITAIRE").
  lot text,
  -- The devis's own wording, never rewritten into our vocabulary: a chef has
  -- to recognise his own quote on screen.
  label text not null check (length(trim(label)) between 1 and 500),
  -- What the devis printed, kept verbatim ("ML", "P", "E") next to the unit
  -- we mapped it to, so a bad mapping is visible rather than buried.
  source_unit text,
  unit text check (unit in ('m', 'm2', 'm3', 'unit', 'kg')),
  quantity numeric(14, 3),
  unit_price numeric(14, 2),
  amount_ht numeric(14, 2),
  -- The catalogue code this line counts against. Suggested by the parser,
  -- confirmed by the chef; without it the line has no progress, which is
  -- better than progress against the wrong thing.
  task_code text references public.task_codes(code),
  -- A heading carries no quantity and is not work; a discount is not work
  -- either. Both are kept so the document reads as it was written.
  kind text not null default 'work' check (kind in ('work', 'heading', 'discount')),
  created_at timestamptz not null default now(),
  unique (quote_id, position)
);

create index quote_lines_quote_idx on public.quote_lines (quote_id, position);
create index quote_lines_code_idx on public.quote_lines (company_id, task_code);

alter table public.quote_lines enable row level security;
grant select, insert, update, delete on public.quote_lines to authenticated;

create policy quote_lines_company_read on public.quote_lines for select to authenticated
  using (company_id = public.current_profile_company_id());

-- Only a chef edits a quote's lines, and only inside his own company.
create policy quote_lines_chef_write on public.quote_lines for insert to authenticated
  with check (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
  );

create policy quote_lines_chef_update on public.quote_lines for update to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
  with check (company_id = public.current_profile_company_id());

create policy quote_lines_chef_delete on public.quote_lines for delete to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id());

grant update (status, parsed_at, parse_error, total_ht, currency) on public.site_quotes to authenticated;

create policy site_quotes_chef_update on public.site_quotes for update to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
  with check (company_id = public.current_profile_company_id());
