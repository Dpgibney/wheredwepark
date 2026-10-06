-- ============================================================
-- Where'd We Park — Security audit fixes (round 5)
-- Idempotent: safe to run against an existing project.
-- Run this in the Supabase SQL Editor.
--
-- Step 1 of 2 for the invite display-name leak, and safe for every
-- app version (older apps ignore the new column). Step 2, at the
-- bottom and commented out, should only run once most users are on
-- an app version that shows invited_email for pending invites.
-- ============================================================

-- ------------------------------------------------------------
-- 1. car_shares.invited_email: the address the owner typed.
--
--    invite_to_car returns nothing so it can't be used to probe
--    which emails have accounts, but an owner can read their pending
--    shares with the invitee's profile embedded, which reveals the
--    display name of any registered email. Storing the typed address
--    lets the app show pending invites without the profile, so step 2
--    can hide pending invitees' profiles from owners.
-- ------------------------------------------------------------

alter table car_shares
  add column if not exists invited_email text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'car_shares_invited_email_check'
  ) then
    alter table car_shares
      add constraint car_shares_invited_email_check
      check (invited_email is null or char_length(invited_email) <= 320);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. invite_to_car: look recipients up by their confirmed login email
--    in auth.users, and record the typed address on the share.
--
--    profiles.email is copied at signup, before the address is
--    confirmed, and never updated afterwards. It can therefore point
--    at an unconfirmed (possibly squatted) account, or at an address
--    the user has since changed. auth.users is authoritative.
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- STEP 2: run LATER, once most users have an app version that
-- shows invited_email for pending invites. Older versions will show
-- "—" for pending invites after this.
--
-- Owners then see a pending invitee's profile (display name, email,
-- signup date) only after the invitee accepts. Inviters stay visible
-- to invitees (branch 1), so invite cards keep working.
-- ------------------------------------------------------------

-- create or replace function user_connected_to_profile(p_profile_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public, pg_temp
-- as $$
--   select exists (
--     select 1 from cars c
--     where c.owner_id = p_profile_id
--       and (
--         c.owner_id = auth.uid()
--         or exists (
--           select 1 from car_shares cs
--           where cs.car_id = c.id and cs.shared_with_user_id = auth.uid()
--         )
--       )
--   ) or exists (
--     select 1 from cars c
--     join car_shares cs on cs.car_id = c.id
--     where c.owner_id = auth.uid()
--       and cs.shared_with_user_id = p_profile_id
--       and cs.status = 'accepted'
--   ) or exists (
--     select 1 from parking_locations pl
--     where pl.updated_by_user_id = p_profile_id
--       and user_has_car_access(pl.car_id)
--   );
-- $$;
