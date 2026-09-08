-- A site now carries the coordinates the platform geocoder resolved for its
-- address, so it can be pinned on the team map. The address stops being optional.
alter table public.sites add column latitude double precision check (latitude between -90 and 90);
alter table public.sites add column longitude double precision check (longitude between -180 and 180);
grant select (latitude, longitude), insert (latitude, longitude), update (latitude, longitude)
  on public.sites to authenticated;

-- A plain CHECK would also reject every UPDATE of a site created before this rule,
-- so deactivating a legacy site would start failing. The rule therefore binds every
-- insert, and on update only guards a site that is already located from losing it.
create function public.enforce_site_address()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (old.address is not null and old.latitude is not null) then
    if new.address is null or length(btrim(new.address)) = 0
       or new.latitude is null or new.longitude is null then
      raise exception 'A site needs an address recognised by the map' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger sites_enforce_site_address
  before insert or update on public.sites
  for each row execute function public.enforce_site_address();
