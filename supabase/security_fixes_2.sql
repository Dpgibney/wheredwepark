-- ============================================================
-- Where'd We Park — Security audit fixes (round 2)
-- Idempotent: safe to run against an existing project.
-- Run this in the Supabase SQL Editor.
--
-- No matching app release is required — these only tighten
-- server-side authorization the client already respects.
-- ============================================================

-- ------------------------------------------------------------
-- 1. car_shares: stop a recipient from re-pointing their share
--    row at another car.
--
--    The "Recipients can update share status" policy only checks
--    that shared_with_user_id stays the caller — it never pins
--    car_id. A user could therefore take a share row they legit-
--    imately own (or self-insert one for their own car) and
--    UPDATE car_id to any victim car's UUID + status='accepted',
--    which makes user_has_car_access() grant them full access.
--
--    parking_locations already has an equivalent guard; car_shares
--    was missing one. Lock car_id and shared_with_user_id so only
--    status can change on an existing share.
-- ------------------------------------------------------------

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

-- Defense in depth: there is no legitimate reason to create a share
-- to yourself (invite_to_car already excludes the caller), and a
-- self-share is the bootstrap step for the pivot above. Forbid it.
drop policy if exists "Owners can create shares" on car_shares;
create policy "Owners can create shares"
  on car_shares for insert
  with check (
    exists (select 1 from cars where id = car_id and owner_id = auth.uid())
    and status = 'pending'
    and shared_with_user_id <> auth.uid()
  );

-- ------------------------------------------------------------
-- 2. profiles.email: treat as authoritative from auth.users.
--
--    "Users can update own profile" has no WITH CHECK and no
--    column restriction, so a user could rewrite their own
--    profiles.email to a victim's address. invite_to_car resolves
--    recipients by profiles.email, so an attacker could intercept
--    an invite meant for that address (and spoof identity in the
--    owner's share list). email is owned by auth.users and synced
--    on signup by handle_new_user — make it immutable from the
--    client by ignoring any change on UPDATE.
-- ------------------------------------------------------------

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
