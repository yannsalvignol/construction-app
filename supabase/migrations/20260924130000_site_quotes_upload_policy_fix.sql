-- The upload policy's subquery said `storage.foldername(name)`, and inside
-- `select 1 from public.sites s` that `name` bound to the site's own name
-- column rather than the object path — so the chantier check could never match
-- and every upload was refused. The outer column is qualified here.

drop policy if exists site_quote_upload on storage.objects;

create policy site_quote_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'site-quotes'
  and (storage.foldername(objects.name))[1] = public.current_profile_company_id()::text
  and public.current_profile_role() = 'chef'
  and exists (
    select 1 from public.sites s
    where s.id::text = (storage.foldername(objects.name))[2]
      and s.company_id = public.current_profile_company_id()
  )
);
