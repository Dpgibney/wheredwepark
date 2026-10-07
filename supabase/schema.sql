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
  -- Address the owner typed (set by invite_to_car); shown for pending invites.
  invited_email        text check (invited_email is null or char_length(invited_email) <= 320),
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
-- email; we look up the account internally and create a pending share row.
-- Returns nothing — same result whether the email is registered or not, so
-- the RPC itself can't be used to enumerate accounts. Recipients are matched
-- on their confirmed login email in auth.users (profiles.email is copied at
-- signup, before confirmation, and never updated), and the typed address is
-- stored so the app can show pending invites without the invitee's profile.
create or replace function invite_to_car(p_car_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email     text := lower(trim(p_email));
  v_recipient uuid;
begin
  if not exists (
    select 1 from cars
    where id = p_car_id and owner_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select u.id into v_recipient
  from auth.users u
  where lower(u.email) = v_email
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and u.id <> auth.uid()
  limit 1;

  if v_recipient is null then
    return;
  end if;

  insert into car_shares (car_id, shared_with_user_id, status, invited_email)
  values (p_car_id, v_recipient, 'pending', v_email)
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

-- Rate limit: 3 submissions per user per rolling hour. contact-support inserts
-- (reserves) its row before sending the email, and this trigger serializes the
-- count + insert per user so a burst of parallel requests can't all pass.
-- PT429: PostgREST maps PT-prefixed SQLSTATEs to that HTTP status, and the
-- function keys its 429 response off it.
create or replace function check_support_rate_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('support_rate:' || new.user_id::text));
  if (select count(*) from support_requests
      where user_id = new.user_id
        and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Support request rate limit exceeded' using errcode = 'PT429';
  end if;
  return new;
end;
$$;

create trigger enforce_support_rate_limit
  before insert on support_requests
  for each row execute procedure check_support_rate_limit();

-- Every read/write goes through the service-role contact-support edge function,
-- which bypasses RLS. Enabling RLS with NO policies denies all direct client
-- access, countering the schema-wide `grant all on all tables to authenticated`.
alter table support_requests enable row level security;

-- The contact-support edge function reads/writes this table as the service_role,
-- which the authenticated-only grants above don't cover. Without USAGE on the
-- schema service_role can't even see the table ("relation does not exist").
-- DELETE lets it release a reserved row when the email send fails.
grant usage on schema public to service_role;
grant select, insert, delete on support_requests to service_role;

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
-- so a shared user can't fill the owner's folder with extra files. The folder
-- is round-tripped through ::uuid::text because the ::uuid cast alone also
-- accepts upper-case and re-hyphenated spellings of the same car id.
-- SELECT/DELETE stay permissive so owners can clean up any pre-existing extras.
create policy "Users with car access can upload parking images"
  on storage.objects for insert
  with check (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
    and name = ((storage.foldername(name))[1])::uuid::text || '/parking.jpg');

create policy "Users with car access can update parking images"
  on storage.objects for update
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
    and name = ((storage.foldername(name))[1])::uuid::text || '/parking.jpg');

create policy "Users with car access can delete parking images"
  on storage.objects for delete
  using (bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid));

-- ------------------------------------------------------------
-- PHOTO CLEANUP WEBHOOK (created in the Dashboard, not by this file)
-- Dashboard → Database → Webhooks: "on_car_deleted", table cars, event
-- DELETE, POST to the delete-car-assets edge function, with headers
-- Authorization: Bearer <service role key> and x-webhook-secret: <the
-- function's WEBHOOK_SECRET>. The notification webhooks below copy its
-- URL and headers, so the secret never appears in this repo.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- PUSH NOTIFICATIONS
-- Generic "you've been invited" notifications to invitees, and opt-in
-- per-car "<car> was parked" alerts, sent by the send-notifications edge
-- function. Never includes coordinates, or text chosen by someone the
-- recipient hasn't accepted a share from. The service role gets no table
-- access; send-notifications only calls claim_notifications and
-- forget_push_tokens.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. push_tokens: one row per device, owned by whoever signed in on
--    it last. Only the functions below touch it.
-- ------------------------------------------------------------

create table if not exists push_tokens (
  token               text primary key
                      check (char_length(token) <= 255 and token ~ '^Expo(nent)?PushToken\[[^]]+\]$'),
  user_id             uuid not null references auth.users on delete cascade,
  platform            text not null check (platform in ('ios', 'android')),
  -- sha256 of a random secret the registering app install keeps in its
  -- keychain; see register_push_token.
  device_secret_hash  text not null check (device_secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at          timestamptz not null default now()
);

-- Projects that created push_tokens before device_secret_hash existed. Adding
-- a NOT NULL column only works while the table is empty, which it is until
-- an app version that registers tokens ships.
alter table push_tokens
  add column if not exists device_secret_hash text not null
  check (device_secret_hash ~ '^[0-9a-f]{64}$');

create index if not exists push_tokens_user_idx on push_tokens (user_id);

alter table push_tokens enable row level security;
revoke all on push_tokens from anon, authenticated;

-- ------------------------------------------------------------
-- 2. car_notification_prefs: per user, per car, "notify me when this
--    car is parked". Off unless the user turns it on.
-- ------------------------------------------------------------

create table if not exists car_notification_prefs (
  user_id         uuid not null references profiles(id) on delete cascade,
  car_id          uuid not null references cars(id) on delete cascade,
  notify_on_park  boolean not null default false,
  primary key (user_id, car_id)
);

create index if not exists car_notification_prefs_car_idx
  on car_notification_prefs (car_id) where notify_on_park;

alter table car_notification_prefs enable row level security;
grant select, insert, update, delete on car_notification_prefs to authenticated;
revoke all on car_notification_prefs from anon;

drop policy if exists "Users can view their own notification prefs" on car_notification_prefs;
create policy "Users can view their own notification prefs"
  on car_notification_prefs for select
  using (auth.uid() = user_id);

-- Only for cars the user can currently see. claim_notifications re-checks
-- access at send time, so a leftover row after a share is removed is inert.
drop policy if exists "Users can add notification prefs for cars they can access" on car_notification_prefs;
create policy "Users can add notification prefs for cars they can access"
  on car_notification_prefs for insert
  with check (auth.uid() = user_id and user_has_car_access(car_id));

drop policy if exists "Users can update their own notification prefs" on car_notification_prefs;
create policy "Users can update their own notification prefs"
  on car_notification_prefs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and user_has_car_access(car_id));

drop policy if exists "Users can delete their own notification prefs" on car_notification_prefs;
create policy "Users can delete their own notification prefs"
  on car_notification_prefs for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. notification_log: what was sent, used to throttle repeats (an
--    owner re-inviting in a loop, or a car parked several times in a
--    row) and to cap invites per recipient per day. Purged daily of rows
--    older than a day, which is as far back as the throttles look.
-- ------------------------------------------------------------

create table if not exists notification_log (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references auth.users on delete cascade,
  kind          text not null check (kind in ('invite', 'parked')),
  car_id        uuid not null,
  sent_at       timestamptz not null default now()
);

create index if not exists notification_log_recent_idx
  on notification_log (recipient_id, kind, car_id, sent_at desc);

alter table notification_log enable row level security;
revoke all on notification_log from anon, authenticated;

select cron.schedule(
  'purge-old-notification-log',
  '30 4 * * *',
  $$ delete from public.notification_log where sent_at < now() - interval '1 day' $$
);

-- ------------------------------------------------------------
-- 4. Functions.
-- ------------------------------------------------------------

-- Called by the app after sign-in. p_device_secret is a random value the
-- app install generated and keeps in its keychain; only its hash is stored,
-- and it never changes once set. A registered token can only be moved to
-- another account by the install that registered it, so knowing a device's
-- token isn't enough to take over its notifications, even with a stolen
-- session for the account it belongs to. A different person signing in on
-- the same phone is the same install, so handing a phone over still works.
-- A token and its secret belong to the same install (a reinstall or new
-- phone gets a new token), so a legitimate device never needs a new secret
-- for an old token.
--
-- Known limit: whoever registers a token first owns it, so someone who knew
-- a device's token before that device registered could squat it (the owner
-- would then get no pushes; no data is exposed). Tokens never leave the
-- device except to Expo and this table, which no user can read. Closing
-- this fully needs proof of possession (a challenge push the device must
-- answer).
--
-- Returns false if the token belongs to another install. Keeps each user's
-- 10 most recent devices.
drop function if exists register_push_token(text, text);
create or replace function register_push_token(p_token text, p_platform text, p_device_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registered boolean;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_device_secret is null or char_length(p_device_secret) < 32 then
    raise exception 'invalid device secret' using errcode = '22023';
  end if;

  insert into push_tokens (token, user_id, platform, device_secret_hash, updated_at)
  values (p_token, auth.uid(), p_platform,
          encode(extensions.digest(p_device_secret, 'sha256'), 'hex'), now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now()
    where push_tokens.device_secret_hash = excluded.device_secret_hash
  returning true into v_registered;

  if v_registered is null then
    return false;
  end if;

  delete from push_tokens
  where user_id = auth.uid()
    and token not in (
      select token from push_tokens
      where user_id = auth.uid()
      order by updated_at desc
      limit 10
    );
  return true;
end;
$$;

-- Called by the app just before signing out.
create or replace function unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from push_tokens where token = p_token and user_id = auth.uid();
$$;

-- Called by send-notifications for each webhook event. Works out who to
-- notify, drops anyone notified about the same thing recently, logs the
-- rest, and returns one row per device to send to.
--   p_kind 'invite': p_ref is the car_shares id; notifies the invitee.
--   p_kind 'parked': p_ref is the car id; notifies opted-in users who can
--                    still see the car (owner or accepted share), except
--                    whoever saved the spot.
--
-- Anyone can invite any registered email, so invites return no car name
-- and no names at all: otherwise a stranger could put their own text on
-- someone's lock screen (phishing, spam) or pose as someone they trust.
-- The app shows who sent the invite, with their verified email. Parked
-- alerts only reach people who accepted the share and opted in; they get
-- the car's name (set by its owner) but not the parker's display name,
-- which is self-chosen. Invites are also capped at 5 per recipient per
-- day, however many people or cars they come from.
--
-- The return type changed (actor_name dropped), which CREATE OR REPLACE
-- can't do, so drop first.
drop function if exists claim_notifications(text, uuid);
create function claim_notifications(p_kind text, p_ref uuid)
returns table (token text, car_id uuid, car_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_window interval;
  v_recipient uuid;
begin
  v_window := case p_kind
    when 'invite' then interval '1 hour'
    when 'parked' then interval '10 minutes'
  end;
  if v_window is null then
    raise exception 'unknown notification kind: %', p_kind;
  end if;

  -- Serialize claims that check the same throttle rows, so concurrent webhook
  -- calls can't all pass a check before any of them logs. Invites lock on the
  -- recipient: the daily cap and the per-car throttle count every invite to
  -- that person, which arrive under different share ids. Parked alerts lock
  -- on the car, which covers their per-car throttle.
  if p_kind = 'invite' then
    select cs.shared_with_user_id into v_recipient from car_shares cs where cs.id = p_ref;
    if v_recipient is null then
      return;  -- invite already deleted
    end if;
    perform pg_advisory_xact_lock(hashtext('notify:invite-recipient:' || v_recipient::text));
  else
    perform pg_advisory_xact_lock(hashtext('notify:parked:' || p_ref::text));
  end if;

  return query
  with candidates as (
    select cs.shared_with_user_id as recipient_id,
           cs.car_id as car_id,
           null::text as car_name
    from car_shares cs
    where p_kind = 'invite'
      and cs.id = p_ref
      and cs.status = 'pending'

    union all

    select np.user_id,
           c.id,
           c.name
    from parking_locations pl
    join cars c on c.id = pl.car_id
    join car_notification_prefs np on np.car_id = c.id and np.notify_on_park
    where p_kind = 'parked'
      and pl.car_id = p_ref
      and np.user_id is distinct from pl.updated_by_user_id
      and (
        np.user_id = c.owner_id
        or exists (
          select 1 from car_shares cs
          where cs.car_id = c.id
            and cs.shared_with_user_id = np.user_id
            and cs.status = 'accepted'
        )
      )
  ),
  due as (
    select cand.* from candidates cand
    where not exists (
      select 1 from notification_log nl
      where nl.recipient_id = cand.recipient_id
        and nl.kind = p_kind
        and nl.car_id = cand.car_id
        and nl.sent_at > now() - v_window
    )
    and (
      p_kind <> 'invite'
      or (
        select count(*) from notification_log nl
        where nl.recipient_id = cand.recipient_id
          and nl.kind = 'invite'
          and nl.sent_at > now() - interval '1 day'
      ) < 5
    )
  ),
  logged as (
    insert into notification_log (recipient_id, kind, car_id)
    select due.recipient_id, p_kind, due.car_id from due
    returning 1
  )
  select pt.token, due.car_id, due.car_name
  from due
  join push_tokens pt on pt.user_id = due.recipient_id;
end;
$$;

-- Called by send-notifications with tokens Expo reports as no longer
-- registered (app deleted, notifications revoked).
create or replace function forget_push_tokens(p_tokens text[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from push_tokens where token = any (p_tokens);
$$;

-- Supabase's default privileges grant EXECUTE on new functions to anon and
-- authenticated; spell out who may call each one.
revoke all on function register_push_token(text, text, text) from public, anon, authenticated;
revoke all on function unregister_push_token(text)       from public, anon, authenticated;
revoke all on function claim_notifications(text, uuid)   from public, anon, authenticated;
revoke all on function forget_push_tokens(text[])        from public, anon, authenticated;

grant execute on function register_push_token(text, text, text) to authenticated;
grant execute on function unregister_push_token(text)       to authenticated;
grant execute on function claim_notifications(text, uuid)   to service_role;
grant execute on function forget_push_tokens(text[])        to service_role;

-- ------------------------------------------------------------
-- 5. Database webhooks into send-notifications.
--
--    They reuse the URL and headers (service-role JWT + x-webhook-secret)
--    of the on_car_deleted webhook, created in Dashboard → Database →
--    Webhooks for delete-car-assets, so the secret never appears in this
--    file. Both functions read the same WEBHOOK_SECRET.
-- ------------------------------------------------------------

do $$
declare
  v_args    text[];
  v_url     text;
  v_headers text;
begin
  select string_to_array(encode(tgargs, 'escape'), '\000')
    into v_args
  from pg_trigger
  where tgname = 'on_car_deleted';

  if v_args is null then
    raise notice 'on_car_deleted webhook not found: create it (see PHOTO CLEANUP WEBHOOK above), then re-run this block';
    return;
  end if;

  v_url := replace(v_args[1], '/functions/v1/delete-car-assets', '/functions/v1/send-notifications');
  v_headers := v_args[3];

  execute 'drop trigger if exists notify_share_created on public.car_shares';
  execute format(
    'create trigger notify_share_created
       after insert on public.car_shares
       for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000');

  execute 'drop trigger if exists notify_car_parked_insert on public.parking_locations';
  execute format(
    'create trigger notify_car_parked_insert
       after insert on public.parking_locations
       for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000');

  -- Only when the spot moves; note and photo edits don't notify.
  execute 'drop trigger if exists notify_car_parked_update on public.parking_locations';
  execute format(
    'create trigger notify_car_parked_update
       after update on public.parking_locations
       for each row
       when (old.latitude is distinct from new.latitude
             or old.longitude is distinct from new.longitude)
       execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000');
end $$;

-- ------------------------------------------------------------
-- MINIMUM SUPPORTED APP VERSION (see lib/app-version.ts)
-- Raise min_build for a platform to make older builds show a blocking
-- "Update required" screen. The build number is the iOS CFBundleVersion
-- or Android versionCode, shown in Settings → About.
-- ------------------------------------------------------------

create table if not exists app_min_versions (
  platform    text primary key check (platform in ('ios', 'android')),
  min_build   integer not null default 0 check (min_build >= 0),
  store_url   text check (store_url is null or store_url like 'https://%'),
  updated_at  timestamptz not null default now()
);

insert into app_min_versions (platform, min_build, store_url) values
  ('ios', 0, null),
  ('android', 0, 'https://play.google.com/store/apps/details?id=com.dgibney.wheredwepark1')
on conflict (platform) do nothing;

-- Readable before sign-in (anon), so a signed-out old build still gets the
-- message; nothing here is sensitive. No write policies: change it from the
-- SQL Editor or Dashboard only.
alter table app_min_versions enable row level security;

drop policy if exists "Anyone can read minimum app versions" on app_min_versions;
create policy "Anyone can read minimum app versions"
  on app_min_versions for select
  to anon, authenticated
  using (true);

revoke all on app_min_versions from anon, authenticated;
grant select on app_min_versions to anon, authenticated;
