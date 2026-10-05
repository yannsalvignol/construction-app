-- A bound on the avatars bucket, and a sweep for the ones nobody owns.
--
-- The bucket was created public with no file_size_limit and no mime allowlist,
-- which is the only bucket in the project without either: an authenticated
-- account could put fifty megabytes of anything into its own folder and the
-- app would serve it. The app now sends a 512px JPEG of perhaps forty
-- kilobytes, so a megabyte is generous by a factor of twenty-five and still
-- refuses the thing worth refusing.
--
-- Applied to the bucket rather than enforced in the client, because a limit
-- the client holds is a limit anybody with the anon key can decline to hold.
update storage.buckets
   set file_size_limit = 1048576,
       allowed_mime_types = array['image/jpeg', 'image/png']
 where id = 'avatars';

/**
 * Avatars whose owner is gone.
 *
 * Replacing a photograph does not leave one behind — the upload overwrites a
 * fixed path — but removing an employee does: remove_employee deletes the
 * profile and SQL cannot delete Storage bytes, so the file outlived the person
 * it belonged to, publicly readable, for as long as the bucket existed.
 *
 * Swept by the presence worker with the service role, next to the presence
 * proofs, rather than by whoever happened to trigger the deletion: a cleanup
 * that depends on a client finishing its turn is a cleanup that does not
 * happen when the client is on a chantier with no signal.
 *
 * The hour of grace is for the gap between an avatar being uploaded and the
 * profile row naming it; a file younger than that is somebody's upload in
 * progress, not an orphan.
 */
create or replace function public.orphan_avatars()
returns table(path text) language sql security definer set search_path = '' as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'avatars'
     and o.created_at < now() - interval '1 hour'
     and not exists (
       select 1 from public.profiles p
        where p.id::text = (storage.foldername(o.name))[1]
     )
   limit 100;
$$;
revoke all on function public.orphan_avatars() from public, anon, authenticated;
grant execute on function public.orphan_avatars() to service_role;
