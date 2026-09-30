-- A devis is often several sheets of paper. Photographing one page and
-- calling it the quote loses the other seven, so a quote now holds an ordered
-- set of pages, and a single PDF is simply a quote with one page.
--
-- site_quotes.file_path stays as the first page, so everything already
-- imported keeps working and a reader that only wants "the file" still has
-- one.

create table public.quote_pages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.site_quotes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Order the pages were captured in, which is the order they are read in.
  position integer not null,
  file_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  unique (quote_id, position)
);

create index quote_pages_quote_idx on public.quote_pages (quote_id, position);

alter table public.quote_pages enable row level security;
grant select, insert, delete on public.quote_pages to authenticated;

create policy quote_pages_read on public.quote_pages for select to authenticated
  using (company_id = public.current_profile_company_id());

create policy quote_pages_chef_insert on public.quote_pages for insert to authenticated
  with check (
    public.current_profile_role() = 'chef'
    and company_id = public.current_profile_company_id()
  );

create policy quote_pages_chef_delete on public.quote_pages for delete to authenticated
  using (public.current_profile_role() = 'chef' and company_id = public.current_profile_company_id());

-- Everything imported before this migration was a single file.
insert into public.quote_pages (quote_id, company_id, position, file_path, mime_type, size_bytes)
select id, company_id, 0, file_path, mime_type, size_bytes
from public.site_quotes
on conflict (file_path) do nothing;
