-- Two things the first real devis (Castor, VILLA YACOUBI) taught us.
--
-- 1. The catalogue was written for plumbing and electrical labour, so 92 of
--    its 99 priced lines matched nothing. The families below are taken
--    straight from that devis: DRV equipment, ventilation, underfloor
--    heating. Without a code a line has no denominator and no progress.
--
-- 2. Hand-adding codes after every devis does not scale. A line that stays
--    unmatched is now recorded as a candidate, counted across devis, and
--    offered to the chef once it has appeared often enough to be a real part
--    of the trade rather than a one-off.

insert into public.task_codes (code, category_code, label_fr, label_en, unit, sort_order, is_active) values
  ('CVC_DRV_EXT',        'plumbing_hvac', 'Pose unité extérieure DRV',            'Install DRV outdoor unit',        'unit', 23, true),
  ('CVC_DRV_INT',        'plumbing_hvac', 'Pose unité intérieure gainable DRV',   'Install DRV ducted indoor unit',  'unit', 24, true),
  ('CVC_FRIGO',          'plumbing_hvac', 'Réseau frigorifique',                  'Refrigerant piping',              'm',    25, true),
  ('CVC_CONDENSAT',      'plumbing_hvac', 'Réseau condensat',                     'Condensate piping',               'm',    26, true),
  ('CVC_PLENUM',         'plumbing_hvac', 'Pose plénum soufflage / reprise',      'Install supply/return plenum',    'unit', 27, true),
  ('CVC_GRILLE_REPRISE', 'plumbing_hvac', 'Pose grille de reprise',               'Install return grille',           'unit', 28, true),
  ('CVC_GAINE_RECT',     'plumbing_hvac', 'Pose gaine rectangulaire',             'Install rectangular duct',        'm2',   29, true),
  ('CVC_GAINE_FLEX',     'plumbing_hvac', 'Pose gaine flexible',                  'Install flexible duct',           'm',    30, true),
  ('CVC_CAISSON_EXTR',   'plumbing_hvac', 'Pose caisson d''extraction',           'Install extraction box',          'unit', 31, true),
  ('CVC_VENTIL_GAINE',   'plumbing_hvac', 'Pose ventilateur de gaine',            'Install in-duct fan',             'unit', 32, true),
  ('CVC_BOUCHE_VMC',     'plumbing_hvac', 'Pose bouche VMC',                      'Install VMC air inlet',           'unit', 33, true),
  ('CVC_GRILLE_EXTR',    'plumbing_hvac', 'Pose grille d''extraction',            'Install extraction grille',       'unit', 34, true),
  ('CHF_PAC',            'plumbing_hvac', 'Pose pompe à chaleur',                 'Install heat pump',               'unit', 35, true),
  ('CHF_COLLECTEUR',     'plumbing_hvac', 'Pose collecteur départ / retour',      'Install flow/return manifold',    'unit', 36, true),
  ('CHF_BALLON',         'plumbing_hvac', 'Pose préparateur eau chaude',          'Install hot water cylinder',      'unit', 37, true),
  ('CHF_REGULATION',     'plumbing_hvac', 'Pose régulation chauffage',            'Install heating control',         'unit', 38, true),
  ('CHF_POMPE_CIRC',     'plumbing_hvac', 'Pose pompe de circulation',            'Install circulation pump',        'unit', 39, true),
  ('CHF_PLANCHER',       'plumbing_hvac', 'Pose plancher chauffant',              'Install underfloor heating',      'm2',   40, true),
  ('CHF_THERMOSTAT',     'plumbing_hvac', 'Pose thermostat',                      'Install thermostat',              'unit', 41, true),
  ('CHF_SECHE_SERV',     'plumbing_hvac', 'Pose sèche-serviette',                 'Install towel radiator',          'unit', 42, true),
  ('PLB_PER',            'plumbing_hvac', 'Distribution PER',                     'PER pipe distribution',           'm',    43, true),
  ('PLB_VANNE',          'plumbing_hvac', 'Pose vanne d''arrêt',                  'Install shut-off valve',          'unit', 44, true),
  ('PLB_COLLECTEUR',     'plumbing_hvac', 'Pose collecteur de distribution',      'Install distribution manifold',   'unit', 45, true),
  ('PLB_CALORIFUGE',     'plumbing_hvac', 'Calorifugeage de canalisation',        'Pipe insulation',                 'm',    46, true),
  ('PLB_SIPHON_SOL',     'plumbing_hvac', 'Pose siphon de sol',                   'Install floor drain',             'unit', 47, true),
  ('PLB_GARGOUILLE',     'plumbing_hvac', 'Pose gargouille',                      'Install roof outlet',             'unit', 48, true),
  ('PLB_ANTI_BELIER',    'plumbing_hvac', 'Pose système anti-bélier',             'Install water hammer arrester',   'unit', 49, true),
  ('PLB_POMPE_RELEV',    'plumbing_hvac', 'Pose pompe de relevage',               'Install lifting pump',            'unit', 50, true),
  ('PLB_COFFRET',        'plumbing_hvac', 'Pose coffret de distribution',         'Install distribution box',        'unit', 51, true)
on conflict (code) do nothing;

-- Folding accents needs unaccent where it is available. A later migration
-- replaces every use of it with public.fold_label, which needs no extension,
-- so a Postgres without it (the contract test builds a bare one) is fine.
do $$
begin
  create extension if not exists unaccent with schema extensions;
exception when others then
  raise notice 'unaccent unavailable; public.fold_label is used instead';
end
$$;

-- The meaningful name of a line. A lettered child ("a- Pf : 14 kw") means
-- nothing on its own: what identifies the work is the heading above it
-- ("2- UNITE INTERIEURE GAINABLE DRV"). The parser fills this in; for a line
-- that stands alone it is simply the label.
alter table public.quote_lines add column candidate_label text;

-- What the parser could not match, remembered across devis.
--
-- Keyed on a normalised label so "12- RADIATEURS" and "9- Radiateurs" are the
-- same candidate, while the first label seen is kept verbatim for the chef to
-- recognise. Counted per company: a Casablanca plumber and a Rabat electrician
-- do not share a trade vocabulary.
create table public.task_code_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  normalised text not null,
  sample_label text not null,
  unit text check (unit in ('m', 'm2', 'm3', 'unit', 'kg')),
  -- Distinct devis it has appeared in, which is the number that matters: ten
  -- lines of the same thing in one devis is still one piece of evidence.
  occurrences integer not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'ignored')),
  -- Set when the chef promotes it, so the candidate is not offered twice.
  created_code text references public.task_codes(code),
  unique (company_id, normalised)
);

create index task_code_candidates_ready_idx
  on public.task_code_candidates (company_id, occurrences desc)
  where status = 'pending';

alter table public.task_code_candidates enable row level security;
grant select on public.task_code_candidates to authenticated;

create policy candidates_company_read on public.task_code_candidates for select to authenticated
  using (company_id = public.current_profile_company_id());

-- How many distinct devis a label must appear in before it is offered. Three
-- is the point where a wording stops looking like one supplier's quirk.
create or replace function public.task_code_candidate_threshold()
returns integer language sql immutable as $$ select 3 $$;

/**
 * Records the unmatched lines of a devis, one count per distinct quote.
 * Security definer because employees may not write the catalogue tables, and
 * the parser calls this as the chef who imported the devis.
 */
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
  if public.current_profile_role() <> 'chef'
     or company <> public.current_profile_company_id() then
    raise exception 'Only a chef of the company may record candidates';
  end if;

  with unmatched as (
    select distinct on (normalised)
      -- Strip the printed numbering ("12- ", "a- ") and the parenthetical
      -- asides ("(PRIX POUR MÉMOIRE)"), then fold case and accents.
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

revoke all on function public.record_quote_candidates(uuid) from public, anon;
grant execute on function public.record_quote_candidates(uuid) to authenticated;

/**
 * Promotes a candidate into the catalogue. The chef supplies the code and the
 * label, so the vocabulary stays his rather than a slug of a supplier's
 * wording, and every devis line already matching it is back-filled.
 */
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

  -- Everything already imported under that wording now counts.
  update public.quote_lines l
    set task_code = new_code
    from public.site_quotes q
    where l.quote_id = q.id
      and q.company_id = row.company_id
      and l.task_code is null
      and lower(extensions.unaccent(trim(regexp_replace(
            regexp_replace(coalesce(nullif(l.candidate_label, ''), l.label), '^\s*[0-9]+\s*-\s*|^\s*[a-z]\s*-\s*', '', 'i'),
            '\s*\([^)]*\)\s*', ' ', 'g')))) = row.normalised;

  return new_code;
end;
$$;

revoke all on function public.promote_task_code_candidate(uuid, text, text, text) from public, anon;
grant execute on function public.promote_task_code_candidate(uuid, text, text, text) to authenticated;
