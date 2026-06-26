-- ============================================================
-- Where'd We Park — Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- SCHEMA PERMISSIONS (required for PostgreSQL 15+ / new Supabase projects)
-- ------------------------------------------------------------

-- authenticated role gets DML only; anon gets none (all app actions require
-- auth). Deliberately not GRANT ALL: that would include TRUNCATE, which RLS
-- does not apply to.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Supabase's project template may have granted anon access to public tables
-- via its own default privileges. anon has no RLS policies so rows were never
-- visible, but strip the grants for defense in depth.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

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
  emoji         text check (char_length(emoji) <= 16),
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
  latitude            double precision not null check (latitude between -90 and 90),
  longitude           double precision not null check (longitude between -180 and 180),
  updated_by_user_id  uuid references profiles(id) not null,
  updated_at          timestamptz default now() not null,
  notes               text check (char_length(notes) <= 500),
  image_path          text check (image_path is null or image_path = car_id::text || '/parking.jpg')
);

-- ------------------------------------------------------------
-- TRIGGER: enforce 10-car limit per user
-- ------------------------------------------------------------

create or replace function check_car_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Serialize per owner so concurrent inserts can't both pass the count.
  perform pg_advisory_xact_lock(hashtext('car_limit:' || new.owner_id::text));
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
set search_path = public, pg_temp
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

-- Hide from /rest/v1/rpc; authenticated still needs EXECUTE for RLS evaluation.
revoke execute on function user_has_car_access(uuid) from public, anon;
grant  execute on function user_has_car_access(uuid) to authenticated;

-- ------------------------------------------------------------
-- TRIGGER: auto-create profile on auth.users insert
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- left(..., 100): an oversized display_name in raw_user_meta_data would
  -- otherwise trip the profiles check constraint and abort the signup.
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data->>'display_name',
                  split_part(new.email, '@', 1)), 100)
  );
  return new;
end;
$$;

-- Only the auth.users trigger invokes this; no PostgREST caller should reach it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

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
set search_path = public, pg_temp
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

revoke execute on function user_connected_to_profile(uuid) from public, anon;
grant  execute on function user_connected_to_profile(uuid) to authenticated;

create policy "Users can view connected profiles"
  on profiles for select
  using (user_connected_to_profile(id));

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- email is owned by auth.users (synced on signup by handle_new_user). The
-- update policy has no column restriction, so a user could otherwise rewrite
-- their profiles.email to a victim's address and intercept invites resolved
-- by invite_to_car. Ignore any client-supplied email change.
create or replace function enforce_profile_email_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.email := old.email;
  return new;
end;
$$;

drop trigger if exists profiles_email_immutable_trigger on profiles;
create trigger profiles_email_immutable_trigger
  before update on profiles
  for each row execute procedure enforce_profile_email_immutable();

-- Atomic invite RPC. The owner of p_car_id calls this with the recipient's
-- email; we look up the profile internally and create a pending share row.
-- Returns nothing — same result whether the email is registered or not, so
-- the function cannot be used to enumerate accounts or learn display names.
create or replace function invite_to_car(p_car_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient uuid;
begin
  if not exists (
    select 1 from cars
    where id = p_car_id and owner_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select id into v_recipient
  from profiles
  where lower(email) = lower(trim(p_email))
    and id <> auth.uid()
  limit 1;

  if v_recipient is null then
    return;
  end if;

  insert into car_shares (car_id, shared_with_user_id, status)
  values (p_car_id, v_recipient, 'pending')
  on conflict (car_id, shared_with_user_id) do nothing;
end;
$$;

revoke all on function invite_to_car(uuid, text) from public;
grant execute on function invite_to_car(uuid, text) to authenticated;

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
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from car_shares
    where car_id = p_car_id
      and shared_with_user_id = auth.uid()
  );
$$;

revoke execute on function user_has_pending_invite(uuid) from public, anon;
grant  execute on function user_has_pending_invite(uuid) to authenticated;

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
    and status = 'pending'
    and shared_with_user_id <> auth.uid()
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

-- The update policy only pins shared_with_user_id, so without this guard a
-- recipient could re-point an existing share at any car (set car_id to a
-- victim's UUID + status='accepted') and self-grant access via
-- user_has_car_access. Lock car_id and shared_with_user_id so only status
-- can change — mirrors the parking_locations update trigger.
create or replace function enforce_car_share_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.car_id <> old.car_id then
    raise exception 'car_id cannot be modified';
  end if;
  if new.shared_with_user_id <> old.shared_with_user_id then
    raise exception 'shared_with_user_id cannot be modified';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_car_share_update_trigger on car_shares;
create trigger enforce_car_share_update_trigger
  before update on car_shares
  for each row execute procedure enforce_car_share_update();

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
set search_path = public, pg_temp
as $$
begin
  if new.car_id <> old.car_id then
    raise exception 'car_id cannot be modified';
  end if;
  -- IS DISTINCT FROM: updated_by_user_id is nullable (ON DELETE SET NULL), and
  -- a plain <> comparison is never true against NULL, which would let a user
  -- forge attribution once the column has been nulled. Transition to NULL must
  -- stay allowed — the FK's SET NULL update fires this trigger with no auth
  -- context.
  if new.updated_by_user_id is distinct from old.updated_by_user_id
     and new.updated_by_user_id is not null
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
-- SUPPORT REQUESTS (Contact Us / Report a Problem)
-- Backs the contact-support edge function: durable record of every
-- submission + per-user rate limiting (3 per hour).
-- ------------------------------------------------------------

create table support_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade not null,
  subject       text not null check (char_length(subject) <= 200),
  message       text not null check (char_length(message) <= 5000),
  contact_email text check (char_length(contact_email) <= 320),
  platform      text check (char_length(platform) <= 100),
  created_at    timestamptz default now() not null
);

-- Supports the rate-limit lookup (one user's rows within the last hour).
create index support_requests_user_created_idx
  on support_requests (user_id, created_at desc);

-- Every read/write goes through the service-role contact-support edge function,
-- which bypasses RLS. Enabling RLS with NO policies denies all direct client
-- access, countering the schema-wide `grant all on all tables to authenticated`.
alter table support_requests enable row level security;

-- The contact-support edge function reads/writes this table as the service_role,
-- which the authenticated-only grants above don't cover. Without USAGE on the
-- schema service_role can't even see the table ("relation does not exist").
grant usage on schema public to service_role;
grant select, insert on support_requests to service_role;

-- Purge rows older than 30 days daily at 04:00 UTC. The rate limiter only looks
-- back 1 hour, so nothing older is needed. Scheduling by name upserts, so this
-- is safe to re-run.
create extension if not exists pg_cron;
select cron.schedule(
  'purge-old-support-requests',
  '0 4 * * *',
  $$ delete from public.support_requests where created_at < now() - interval '30 days' $$
);

-- ------------------------------------------------------------
-- STORAGE: parking photos (private bucket, one image per car)
-- Depends on user_has_car_access — must come after helper function
-- ------------------------------------------------------------

-- 5 MB JPEG-only: the path is pinned by policy below, but without these caps
-- any user with car access could park huge files or non-image content (e.g.
-- HTML) that would then be served from the storage domain via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('parking-images', 'parking-images', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Users with car access can view parking images"
  on storage.objects for select
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid));

-- Writes are pinned to the {car_id}/parking.jpg path the app enforces in code,
-- so a shared user can't fill the owner's folder with extra files.
-- SELECT/DELETE stay permissive so owners can clean up any pre-existing extras.
create policy "Users with car access can upload parking images"
  on storage.objects for insert
  with check (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
    and name = (storage.foldername(name))[1] || '/parking.jpg');

create policy "Users with car access can update parking images"
  on storage.objects for update
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
    and name = (storage.foldername(name))[1] || '/parking.jpg');

create policy "Users with car access can delete parking images"
  on storage.objects for delete
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid));
