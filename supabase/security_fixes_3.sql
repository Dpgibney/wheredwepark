-- ============================================================
-- Where'd We Park — Security audit fixes (round 3)
-- Idempotent: safe to run against an existing project.
-- Run this in the Supabase SQL Editor.
--
-- No matching app release is required — these only tighten
-- server-side behaviour the client already respects.
-- ============================================================

-- ------------------------------------------------------------
-- 1. parking_locations: NULL-safe attribution guard.
--
--    Round 1 (#7) made updated_by_user_id nullable so account
--    deletion can ON DELETE SET NULL. But the update trigger
--    compares with <>, which yields NULL (not true) when either
--    side is NULL, so the exception never fires. Once a row's
--    updated_by_user_id has been nulled by a deleted account,
--    any user with car access can UPDATE it to any other
--    profile's uuid and forge the "last parked by" attribution.
--    The same gap lets anyone null out attribution at will.
--
--    Use IS DISTINCT FROM and explicitly allow only two
--    transitions: -> auth.uid(), and -> NULL (the latter must
--    stay allowed because the FK's ON DELETE SET NULL update
--    fires this trigger with no auth context).
-- ------------------------------------------------------------

create or replace function enforce_parking_location_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.car_id <> old.car_id then
    raise exception 'car_id cannot be modified';
  end if;
  if new.updated_by_user_id is distinct from old.updated_by_user_id
     and new.updated_by_user_id is not null
     and new.updated_by_user_id <> auth.uid() then
    raise exception 'updated_by_user_id can only be set to the current user';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 2. Storage: cap size and content type on the parking-images
--    bucket. The RLS policies pin the {car_id}/parking.jpg path
--    but nothing limits the bytes: any user with car access can
--    upload arbitrarily large files (storage/egress cost) or
--    non-JPEG content (e.g. HTML) that is then served from your
--    Supabase storage domain via signed URLs. The app uploads
--    camera/library JPEGs at quality 0.5, so 5 MB is generous.
-- ------------------------------------------------------------

update storage.buckets
set file_size_limit    = 5242880,           -- 5 MB
    allowed_mime_types = array['image/jpeg']
where id = 'parking-images';

-- ------------------------------------------------------------
-- 3. Least privilege on table grants.
--
--    schema.sql grants ALL on all tables to authenticated, which
--    includes TRUNCATE, REFERENCES and TRIGGER. RLS does NOT
--    apply to TRUNCATE — it is gated only by the privilege.
--    PostgREST doesn't currently expose any of the three, so
--    this isn't directly exploitable today, but there's no
--    reason to hold the grants. Keep only the four DML verbs.
--
--    Also strip anon: this project's grants were written to be
--    authenticated-only, but Supabase's project template sets up
--    default privileges that may have given anon access to these
--    tables when they were created. anon has no RLS policies so
--    rows were never visible, but revoke for defense in depth.
-- ------------------------------------------------------------

revoke truncate, references, trigger
  on all tables in schema public from authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ------------------------------------------------------------
-- 4. handle_new_user: don't let an oversized display_name break
--    signup. The register screen caps it at 100 chars, but a
--    direct API call can send any length in raw_user_meta_data;
--    the profiles.display_name check constraint then makes the
--    trigger raise, which aborts the auth.users insert and turns
--    every such signup into an opaque 500. Truncate instead.
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
    left(coalesce(new.raw_user_meta_data->>'display_name',
                  split_part(new.email, '@', 1)), 100)
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. check_car_limit: close the count-then-insert race. Two
--    concurrent inserts can each see 9 rows and both commit,
--    exceeding the 10-car cap. Serialize per owner with a
--    transaction-scoped advisory lock.
-- ------------------------------------------------------------

create or replace function check_car_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('car_limit:' || new.owner_id::text));
  if (select count(*) from cars where owner_id = new.owner_id) >= 10 then
    raise exception 'Car limit reached. A user may only add up to 10 vehicles.';
  end if;
  return new;
end;
$$;
