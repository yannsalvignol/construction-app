-- The payment terms a devis states, kept as jalons.
--
-- Castor's VILLA YACOUBI devis ends with: 40% acompte, 30% à la livraison du
-- matériel, 20% à la fin des travaux selon métré réalisé, 10% de retenue de
-- garantie. Those are the milestones the spec assumed we would have to invent;
-- the document already carries them, so they are read rather than made up.
--
-- A jalon is validated by the chef, never released automatically by a sum of
-- declared quantities. Money does not move because a worker declared metres.

create table public.quote_milestones (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.site_quotes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  position integer not null,
  -- What the devis calls it, in its own words.
  label text not null check (length(trim(label)) between 1 and 300),
  -- Percentage of the total, when the devis expresses it that way.
  percent numeric(6, 2) check (percent is null or (percent >= 0 and percent <= 100)),
  -- A fixed sum, for a devis that names amounts instead.
  amount_ht numeric(14, 2),
  -- Retenue de garantie is a milestone in the payment schedule but not work:
  -- excluding it keeps "what is owed for work done" honest.
  is_retention boolean not null default false,
  validated_at timestamptz,
  validated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quote_id, position)
);

create index quote_milestones_quote_idx on public.quote_milestones (quote_id, position);

alter table public.quote_milestones enable row level security;
grant select, insert, update, delete on public.quote_milestones to authenticated;

create policy quote_milestones_read on public.quote_milestones for select to authenticated
  using (company_id = public.current_profile_company_id());

create policy quote_milestones_chef_insert on public.quote_milestones for insert to authenticated
  with check (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
  );

create policy quote_milestones_chef_update on public.quote_milestones for update to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id())
  with check (company_id = public.current_profile_company_id());

create policy quote_milestones_chef_delete on public.quote_milestones for delete to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id());
