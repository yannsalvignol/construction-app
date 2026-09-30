-- Devis attached to a chantier: the first half of the devis → avancement
-- feature (docs/DEVIS_AVANCEMENT.md). This stores the document only. Parsing
-- it into lots and quantities comes later and adds columns to this same table,
-- so a chef can already keep the devis where the work is.
--
-- Files live in a private bucket under <company_id>/<site_id>/<uuid>, which is
-- what the storage policies below match on: a chef reaches only their own
-- company's folder, and nothing is public.

create table public.site_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  -- Path inside the site-quotes bucket, not a URL: the bucket is private and
  -- the app asks for a signed URL when it actually needs to show the file.
  file_path text not null unique,
  -- What the chef will recognise in a list, which the storage path is not.
  file_name text not null check (length(trim(file_name)) between 1 and 200),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

create index site_quotes_site_idx on public.site_quotes (site_id, created_at desc);

alter table public.site_quotes enable row level security;
grant select, insert, delete on public.site_quotes to authenticated;

-- Everyone in the company may see which devis exist; only a chef adds or
-- removes one, and only within their own company.
create policy site_quotes_company_read on public.site_quotes for select to authenticated
  using (company_id = public.current_profile_company_id());

create policy site_quotes_chef_insert on public.site_quotes for insert to authenticated
  with check (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.sites s
      where s.id = site_id and s.company_id = public.current_profile_company_id()
    )
  );

create policy site_quotes_chef_delete on public.site_quotes for delete to authenticated
  using (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
  );

-- 20 MB: a scanned devis of a few dozen pages, and nothing like a video.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-quotes', 'site-quotes', false, 20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
);

create policy site_quote_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'site-quotes'
  and (storage.foldername(name))[1] = public.current_profile_company_id()::text
  and public.current_profile_role() = 'chef'
  and exists (
    select 1 from public.sites s
    where s.id::text = (storage.foldername(name))[2]
      and s.company_id = public.current_profile_company_id()
  )
);

create policy site_quote_read on storage.objects for select to authenticated using (
  bucket_id = 'site-quotes'
  and (storage.foldername(name))[1] = public.current_profile_company_id()::text
);

create policy site_quote_delete on storage.objects for delete to authenticated using (
  bucket_id = 'site-quotes'
  and (storage.foldername(name))[1] = public.current_profile_company_id()::text
  and public.current_profile_role() = 'chef'
);
