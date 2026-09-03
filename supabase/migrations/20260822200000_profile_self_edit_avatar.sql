-- ============================================================
-- Self-editable profile info + profile pictures
--
-- Until now nobody could update their own profiles row -- only a
-- chef updating an employee's row was allowed. The Account tab
-- needs users (chef or employee) to edit their own name/phone and
-- set a profile picture.
--
-- Avatars are stored in a public "avatars" bucket, one file per
-- user under a folder named after their own auth uid
-- ("<uid>/avatar.jpg"), which is what the storage policies below
-- check ownership against (the standard Supabase per-user-folder
-- storage pattern). The bucket is public since a profile picture
-- isn't sensitive and this avoids needing signed URLs.
-- ============================================================

alter table public.profiles
    add column avatar_url text;

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

grant update (
    first_name,
    last_name,
    phone,
    avatar_url
) on public.profiles to authenticated;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_public_read"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

create policy "avatars_upload_own"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_update_own"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);
