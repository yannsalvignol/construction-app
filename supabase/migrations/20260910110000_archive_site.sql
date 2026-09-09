-- Removing a site from the chef's list.
--
-- A site that has been worked on cannot be deleted: work_days, task_declarations
-- and presence_check_ins all reference it, and those are company records. Such a
-- site is deactivated instead, which takes it out of every picker and every map
-- while the history that points at it stays readable. A site nobody ever used is
-- deleted outright, since it leaves nothing behind.
create function public.remove_site(site uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare target public.sites;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 select * into target from public.sites where id = site and company_id = public.current_profile_company_id() for update;
 if not found then raise exception 'Site not found'; end if;
 if exists (select 1 from public.work_days where site_id = site) then
   update public.sites set is_active = false where id = site;
   return 'archived';
 end if;
 delete from public.sites where id = site;
 return 'deleted';
end $$;
revoke all on function public.remove_site(uuid) from public, anon;
grant execute on function public.remove_site(uuid) to authenticated;
