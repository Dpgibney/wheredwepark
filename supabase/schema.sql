-- ============================================================
-- Where'd We Park — Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- SCHEMA PERMISSIONS (required for PostgreSQL 15+ / new Supabase projects)
-- ------------------------------------------------------------

-- authenticated role gets full access; anon gets none (all app actions require auth)
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant all on tables to authenticated;
alter default privileges in schema public
  grant all on sequences to authenticated;

-- ------------------------------------------------------------
-- TABLES
-- ------------------------------------------------------------

create table profiles (
  id            uuid references auth.users on delete cascade primary key,
  email         text not null,
  display_name  text check (char_length(display_name) <= 100),
  created_at    timestamptz default now() not null
);

create table cars (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references profiles(id) on delete cascade not null,
  name          text not null check (char_length(name) <= 100),
  license_plate text check (char_length(license_plate) <= 20),
  created_at    timestamptz default now() not null
);

create table car_shares (
  id                   uuid primary key default gen_random_uuid(),
  car_id               uuid references cars(id) on delete cascade not null,
  shared_with_user_id  uuid references profiles(id) on delete cascade not null,
  status               text not null default 'pending' check (status in ('pending', 'accepted')),
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
  notes               text check (char_length(notes) <= 500),
  image_path          text
);

-- ------------------------------------------------------------
-- TRIGGER: enforce 10-car limit per user
-- ------------------------------------------------------------

create or replace function check_car_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from cars where owner_id = new.owner_id) >= 10 then
    raise exception 'Car limit reached. A user may only add up to 10 vehicles.';
  end if;
  return new;
end;
$$;

create trigger enforce_car_limit
  before insert on cars
  for each row execute procedure check_car_limit();

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
    select 1 from cars
      where id = p_car_id and owner_id = auth.uid()
    union all
    select 1 from car_shares
      where car_id = p_car_id
        and shared_with_user_id = auth.uid()
        and status = 'accepted'
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

-- Allows a user to see profiles they are connected to via a shared vehicle
-- (car owner <-> share recipient, and the profile who last updated a location
-- on a car they can see). Used for owner names, invite cards, and
-- "last parked by" attribution.
create or replace function user_connected_to_profile(p_profile_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from cars c
    where c.owner_id = p_profile_id
      and (
        c.owner_id = auth.uid()
        or exists (
          select 1 from car_shares cs
          where cs.car_id = c.id and cs.shared_with_user_id = auth.uid()
        )
      )
  ) or exists (
    select 1 from cars c
    join car_shares cs on cs.car_id = c.id
    where c.owner_id = auth.uid()
      and cs.shared_with_user_id = p_profile_id
  ) or exists (
    select 1 from parking_locations pl
    where pl.updated_by_user_id = p_profile_id
      and user_has_car_access(pl.car_id)
  );
$$;

create policy "Users can view connected profiles"
  on profiles for select
  using (user_connected_to_profile(id));

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Secure RPC for looking up a user by email when sending a share invite.
-- Returns id + display_name only on exact match; no rows otherwise.
create or replace function lookup_profile_for_share(p_email text)
returns table (id uuid, display_name text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.display_name
  from profiles p
  where lower(p.email) = lower(trim(p_email))
    and p.id <> auth.uid()
  limit 1;
$$;

revoke all on function lookup_profile_for_share(text) from public;
grant execute on function lookup_profile_for_share(text) to authenticated;

-- cars
create policy "Users can view accessible cars"
  on cars for select
  using (user_has_car_access(id));

-- Returns true if the current user has any share (pending or accepted) for the car
-- Used to allow pending invite recipients to see car name/type in invite cards
create or replace function user_has_pending_invite(p_car_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from car_shares
    where car_id = p_car_id
      and shared_with_user_id = auth.uid()
  );
$$;

-- Allows pending invite recipients to see car name/type in their invite card
create policy "Users can view cars with pending invites"
  on cars for select
  using (user_has_pending_invite(id));

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

create policy "Shared users can remove themselves"
  on car_shares for delete
  using (auth.uid() = shared_with_user_id);

create policy "Recipients can update share status"
  on car_shares for update
  using (auth.uid() = shared_with_user_id)
  with check (auth.uid() = shared_with_user_id);

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

-- Any user with car access can update (notes, image, etc.).
-- Attribution spoofing and car_id reassignment are blocked by the trigger below.
create policy "Users with access can update parking locations"
  on parking_locations for update
  using (user_has_car_access(car_id))
  with check (user_has_car_access(car_id));

create or replace function enforce_parking_location_update()
returns trigger
language plpgsql
as $$
begin
  if new.car_id <> old.car_id then
    raise exception 'car_id cannot be modified';
  end if;
  if new.updated_by_user_id <> old.updated_by_user_id
     and new.updated_by_user_id <> auth.uid() then
    raise exception 'updated_by_user_id can only be set to the current user';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_parking_location_update_trigger on parking_locations;
create trigger enforce_parking_location_update_trigger
  before update on parking_locations
  for each row execute procedure enforce_parking_location_update();

-- ------------------------------------------------------------
-- STORAGE: parking photos (private bucket, one image per car)
-- Depends on user_has_car_access — must come after helper function
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('parking-images', 'parking-images', false)
on conflict (id) do nothing;

create policy "Users with car access can view parking images"
  on storage.objects for select
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid));

create policy "Users with car access can upload parking images"
  on storage.objects for insert
  with check (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid));

create policy "Users with car access can update parking images"
  on storage.objects for update
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid));

create policy "Users with car access can delete parking images"
  on storage.objects for delete
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid));
