-- ============================================================
-- Where'd We Park — Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- SCHEMA PERMISSIONS (required for PostgreSQL 15+ / new Supabase projects)
-- ------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to anon, authenticated;

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

create table profiles (
  id            uuid references auth.users on delete cascade primary key,
  email         text not null,
  display_name  text,
  created_at    timestamptz default now() not null
);

create table cars (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references profiles(id) on delete cascade not null,
  name          text not null,
  license_plate text,
  created_at    timestamptz default now() not null
);

create table car_shares (
  id                   uuid primary key default gen_random_uuid(),
  car_id               uuid references cars(id) on delete cascade not null,
  shared_with_user_id  uuid references profiles(id) on delete cascade not null,
  created_at           timestamptz default now() not null,
  unique(car_id, shared_with_user_id)
);

-- One row per car (upsert on car_id). Stores the current parking location.
create table parking_locations (
  id                  uuid primary key default gen_random_uuid(),
  car_id              uuid references cars(id) on delete cascade not null unique,
  latitude            double precision not null,
  longitude           double precision not null,
  updated_by_user_id  uuid references profiles(id) not null,
  updated_at          timestamptz default now() not null,
  notes               text
);

-- ------------------------------------------------------------
-- HELPER FUNCTION (used in RLS policies)
-- Returns true if the current user owns the car or has a share
-- ------------------------------------------------------------

create or replace function user_has_car_access(p_car_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from cars      where id = p_car_id and owner_id = auth.uid()
    union all
    select 1 from car_shares where car_id = p_car_id and shared_with_user_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- TRIGGER: auto-create profile on auth.users insert
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table profiles         enable row level security;
alter table cars             enable row level security;
alter table car_shares       enable row level security;
alter table parking_locations enable row level security;

-- profiles
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Allows searching for other users by email when sharing a vehicle
create policy "Authenticated users can search profiles"
  on profiles for select
  using (auth.uid() is not null);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- cars
create policy "Users can view accessible cars"
  on cars for select
  using (user_has_car_access(id));

create policy "Owners can insert cars"
  on cars for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update cars"
  on cars for update
  using (auth.uid() = owner_id);

create policy "Owners can delete cars"
  on cars for delete
  using (auth.uid() = owner_id);

-- car_shares
create policy "Users can view shares they are part of"
  on car_shares for select
  using (
    auth.uid() = shared_with_user_id
    or exists (select 1 from cars where id = car_id and owner_id = auth.uid())
  );

create policy "Owners can create shares"
  on car_shares for insert
  with check (
    exists (select 1 from cars where id = car_id and owner_id = auth.uid())
  );

create policy "Owners can delete shares"
  on car_shares for delete
  using (
    exists (select 1 from cars where id = car_id and owner_id = auth.uid())
  );

-- parking_locations
create policy "Users with access can view parking locations"
  on parking_locations for select
  using (user_has_car_access(car_id));

create policy "Users with access can upsert parking locations"
  on parking_locations for insert
  with check (
    user_has_car_access(car_id)
    and auth.uid() = updated_by_user_id
  );

create policy "Users with access can update parking locations"
  on parking_locations for update
  using (user_has_car_access(car_id))
  with check (auth.uid() = updated_by_user_id);
