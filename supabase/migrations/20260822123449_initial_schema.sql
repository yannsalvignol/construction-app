-- ============================================================
-- Construction Workforce Management
-- Initial database schema
-- ============================================================

-- ============================================================
-- 1. Extensions
-- ============================================================

create schema if not exists extensions;

create extension if not exists postgis
schema extensions;


-- ============================================================
-- 2. Companies
-- ============================================================

create table public.companies (
    id uuid primary key default gen_random_uuid(),

    name text not null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 3. User profiles
--
-- Supabase Auth owns authentication.
-- This table stores application-specific user information.
-- ============================================================

create table public.profiles (
    id uuid primary key
        references auth.users(id)
        on delete cascade,

    company_id uuid not null
        references public.companies(id)
        on delete cascade,

    first_name text not null,
    last_name text not null,

    role text not null
        check (role in ('employee', 'chef')),

    phone text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 4. Construction sites
-- ============================================================

create table public.sites (
    id uuid primary key default gen_random_uuid(),

    company_id uuid not null
        references public.companies(id)
        on delete cascade,

    name text not null,

    address text,

    -- GPS position of the construction site
    location extensions.geography(Point, 4326) not null,

    -- Radius used to determine whether an employee is on site
    geofence_radius_meters integer not null default 100
        check (geofence_radius_meters > 0),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 5. Construction site zones
-- ============================================================

create table public.zones (
    id uuid primary key default gen_random_uuid(),

    site_id uuid not null
        references public.sites(id)
        on delete cascade,

    name text not null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- A zone name should be unique within a site
    unique (site_id, name)
);


-- ============================================================
-- 6. Employee shifts / schedules
-- ============================================================

create table public.shifts (
    id uuid primary key default gen_random_uuid(),

    employee_id uuid not null
        references public.profiles(id)
        on delete cascade,

    site_id uuid not null
        references public.sites(id)
        on delete cascade,

    zone_id uuid
        references public.zones(id)
        on delete set null,

    starts_at timestamptz not null,
    ends_at timestamptz not null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (ends_at > starts_at)
);


-- ============================================================
-- 7. Location events
-- ============================================================

create table public.location_events (
    id bigint generated always as identity primary key,

    employee_id uuid not null
        references public.profiles(id)
        on delete cascade,

    -- Site associated with the event, if known
    site_id uuid
        references public.sites(id)
        on delete set null,

    recorded_at timestamptz not null default now(),

    -- GPS position
    location extensions.geography(Point, 4326) not null,

    -- GPS accuracy reported by the device
    accuracy_meters double precision
        check (accuracy_meters is null or accuracy_meters >= 0),

    event_type text not null
        check (
            event_type in (
                'location_update',
                'enter_site',
                'exit_site'
            )
        )
);


-- ============================================================
-- 8. Indexes
-- ============================================================

-- Companies
create index profiles_company_idx
    on public.profiles (company_id);

create index sites_company_idx
    on public.sites (company_id);


-- Zones
create index zones_site_idx
    on public.zones (site_id);


-- Shifts
create index shifts_employee_time_idx
    on public.shifts (employee_id, starts_at);

create index shifts_site_time_idx
    on public.shifts (site_id, starts_at);

create index shifts_zone_idx
    on public.shifts (zone_id);


-- Location events
create index location_events_employee_time_idx
    on public.location_events (employee_id, recorded_at desc);

create index location_events_site_time_idx
    on public.location_events (site_id, recorded_at desc);


-- Spatial indexes
create index sites_location_idx
    on public.sites
    using gist (location);

create index location_events_location_idx
    on public.location_events
    using gist (location);


-- ============================================================
-- 9. Updated-at trigger
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


create trigger companies_updated_at
before update on public.companies
for each row
execute function public.set_updated_at();


create trigger profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


create trigger sites_updated_at
before update on public.sites
for each row
execute function public.set_updated_at();


create trigger zones_updated_at
before update on public.zones
for each row
execute function public.set_updated_at();


create trigger shifts_updated_at
before update on public.shifts
for each row
execute function public.set_updated_at();