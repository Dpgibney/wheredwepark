-- ============================================================
-- Where'd We Park — Security audit fixes (round 4)
-- Idempotent: safe to run against an existing project.
-- Run this in the Supabase SQL Editor.
--
-- No app release is required. Apply this BEFORE deploying the
-- matching contact-support edge function, which relies on the
-- rate-limit trigger and DELETE grant in section 2.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Storage: pin parking-image writes to the canonical
--    {car_id}/parking.jpg spelling.
--
--    The round-1 pin compares name to folder || '/parking.jpg',
--    but the folder is only validated by the ::uuid cast, which
--    also accepts upper/mixed case and other hyphenations
--    (A0EEBC99-..., a0eebc999c0b..., a0ee-bc99-...). Each
--    spelling resolves to the same car, so a user with car access
--    could store an unlimited number of extra files per car, and
--    delete-car-assets (canonical folder only) never cleans them
--    up. Round-tripping the folder through ::uuid::text yields the
--    canonical lowercase form the app uploads to and the
--    parking_locations.image_path check expects.
-- ------------------------------------------------------------

drop policy if exists "Users with car access can upload parking images" on storage.objects;
create policy "Users with car access can upload parking images"
  on storage.objects for insert
  with check (
    bucket_id = 'parking-images'
    and user_has_car_access((storage.foldername(name))[1]::uuid)
    and name = ((storage.foldername(name))[1])::uuid::text || '/parking.jpg'
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
    and name = ((storage.foldername(name))[1])::uuid::text || '/parking.jpg'
  );

-- ------------------------------------------------------------
-- 2. support_requests: enforce the contact-support rate limit
--    (3 per user per rolling hour) in the database.
--
--    The edge function counted rows, sent the email, and only
--    then inserted, so a burst of parallel requests all passed
--    the count, and a send whose insert failed was never counted.
--    The function now inserts (reserves) first, and this trigger
--    serializes count + insert per user with an advisory lock,
--    the same pattern as check_car_limit.
--
--    PT429: PostgREST maps PT-prefixed SQLSTATEs to that HTTP
--    status, and the function keys its 429 response off it.
-- ------------------------------------------------------------

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

drop trigger if exists enforce_support_rate_limit on support_requests;
create trigger enforce_support_rate_limit
  before insert on support_requests
  for each row execute procedure check_support_rate_limit();

-- The function deletes its reserved row when the email send fails, so a
-- failed send doesn't burn the user's quota.
grant delete on support_requests to service_role;
