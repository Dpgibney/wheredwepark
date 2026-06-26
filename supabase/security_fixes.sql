-- ============================================================
-- Where'd We Park — Security audit fixes
-- Idempotent: safe to run against an existing project.
-- Run this in the Supabase SQL Editor.
--
-- Apply after deploying the matching app release — the share
-- screen swaps lookup_profile_for_share for invite_to_car.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SECURITY DEFINER helpers: pin search_path so a caller with
--    CREATE on any schema in their path can't shadow built-ins
--    and run code as the function owner.
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

-- ------------------------------------------------------------
-- 2. Replace lookup_profile_for_share with invite_to_car.
--    The old RPC let any authenticated user enumerate which
--    emails were registered and learn their display_name. The
--    new RPC performs the share insert internally and returns
--    nothing — same behaviour whether the email is registered
--    or not.
-- ------------------------------------------------------------

drop function if exists lookup_profile_for_share(text);

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

-- ------------------------------------------------------------
-- 3. Pin status='pending' on owner-initiated share inserts.
--    The new RPC always uses 'pending', but direct table
--    inserts from the client should be constrained too.
-- ------------------------------------------------------------

drop policy if exists "Owners can create shares" on car_shares;
create policy "Owners can create shares"
  on car_shares for insert
  with check (
    exists (select 1 from cars where id = car_id and owner_id = auth.uid())
    and status = 'pending'
  );

-- ------------------------------------------------------------
-- 4. cars: add emoji column the app already reads and writes.
-- ------------------------------------------------------------

alter table cars
  add column if not exists emoji text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'cars_emoji_check'
  ) then
    alter table cars
      add constraint cars_emoji_check check (char_length(emoji) <= 16);
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. parking_locations: bound lat/lon and constrain image_path
--    to the {car_id}/parking.jpg invariant the app enforces.
-- ------------------------------------------------------------

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'parking_locations_latitude_check'
  ) then
    alter table parking_locations
      add constraint parking_locations_latitude_check
      check (latitude between -90 and 90);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'parking_locations_longitude_check'
  ) then
    alter table parking_locations
      add constraint parking_locations_longitude_check
      check (longitude between -180 and 180);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'parking_locations_image_path_format'
  ) then
    alter table parking_locations
      add constraint parking_locations_image_path_format
      check (image_path is null or image_path = car_id::text || '/parking.jpg');
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Storage: require {car_id}/parking.jpg path on writes so
--    shared users can't fill the owner's folder with extras.
--    SELECT/DELETE stay permissive so owners can clean up any
--    pre-existing extra objects.
-- ------------------------------------------------------------

drop policy if exists "Users with car access can upload parking images" on storage.objects;
create policy "Users with car access can upload parking images"
  on storage.objects for insert
  with check (
    bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
    and name = (storage.foldername(name))[1] || '/parking.jpg'
  );

drop policy if exists "Users with car access can update parking images" on storage.objects;
create policy "Users with car access can update parking images"
  on storage.objects for update
  using (
    bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
    and name = (storage.foldername(name))[1] || '/parking.jpg'
  );

-- ------------------------------------------------------------
-- 7. parking_locations.updated_by_user_id: allow ON DELETE SET NULL
--    so deleting a user account doesn't fail when that user last
--    updated a parking location on a car owned by someone else
--    (e.g., a shared recipient who saved a location). The car
--    owner's parking spot is preserved; attribution just drops.
-- ------------------------------------------------------------

alter table parking_locations
  alter column updated_by_user_id drop not null;

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'parking_locations'::regclass
    and contype = 'f'
    and conkey = (
      select array_agg(attnum)
      from pg_attribute
      where attrelid = 'parking_locations'::regclass
        and attname = 'updated_by_user_id'
    );
  if v_conname is not null then
    execute format('alter table parking_locations drop constraint %I', v_conname);
  end if;
end $$;

alter table parking_locations
  add constraint parking_locations_updated_by_user_id_fkey
  foreign key (updated_by_user_id) references profiles(id) on delete set null;

-- ------------------------------------------------------------
-- 8. Lock down EXECUTE on SECURITY DEFINER functions so they
--    aren't auto-exposed at /rest/v1/rpc/<name>.
--    - handle_new_user is only invoked by the auth.users trigger;
--      no caller-side grant is needed.
--    - The RLS helpers are called from policy evaluation in the
--      authenticated session, so authenticated keeps EXECUTE but
--      anon (which has no table access anyway) loses it.
--    Functions stay SECURITY DEFINER on purpose: handle_new_user
--    writes to profiles as the schema owner, and the RLS helpers
--    query RLS-protected tables (switching to SECURITY INVOKER
--    would cause recursive policy evaluation).
-- ------------------------------------------------------------

revoke execute on function public.handle_new_user()                from public, anon, authenticated;

revoke execute on function public.user_has_car_access(uuid)        from public, anon;
revoke execute on function public.user_connected_to_profile(uuid)  from public, anon;
revoke execute on function public.user_has_pending_invite(uuid)    from public, anon;

grant   execute on function public.user_has_car_access(uuid)        to authenticated;
grant   execute on function public.user_connected_to_profile(uuid)  to authenticated;
grant   execute on function public.user_has_pending_invite(uuid)    to authenticated;

-- ------------------------------------------------------------
-- 9. Pin search_path on the remaining trigger functions so an
--    unqualified reference (cars, auth.uid()) can't resolve to
--    a shadowed object in a caller-controlled schema. These run
--    as SECURITY INVOKER, so the inserting user's search_path
--    would otherwise apply.
-- ------------------------------------------------------------

create or replace function check_car_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from cars where owner_id = new.owner_id) >= 10 then
    raise exception 'Car limit reached. A user may only add up to 10 vehicles.';
  end if;
  return new;
end;
$$;

create or replace function enforce_parking_location_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
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
