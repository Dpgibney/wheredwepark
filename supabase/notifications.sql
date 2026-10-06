-- ============================================================
-- Where'd We Park — Push notifications
-- Idempotent: safe to run against an existing project.
-- Deploy the send-notifications edge function first (it sits idle
-- until the webhooks in section 5 exist), then run this in the
-- Supabase SQL Editor.
--
-- Safe for every app version: only builds that register a push
-- token (the notifications release) ever receive anything.
--
-- What gets sent (by supabase/functions/send-notifications):
--   * "<owner> shared <car> with you" to the invitee when an invite
--     is created.
--   * "<car> was parked" to the owner and accepted sharers who turned
--     it on for that car (car_notification_prefs), except whoever
--     parked it.
-- Notifications never include coordinates.
--
-- The service role has no access to the core tables in this project,
-- and gets none here: send-notifications only calls the two SECURITY
-- DEFINER functions in section 4, which only the service role can run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. push_tokens: one row per device, owned by whoever signed in on
--    it last. Only the functions below touch it.
-- ------------------------------------------------------------

create table if not exists push_tokens (
  token       text primary key
              check (char_length(token) <= 255 and token ~ '^Expo(nent)?PushToken\[[^]]+\]$'),
  user_id     uuid not null references auth.users on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  updated_at  timestamptz not null default now()
);

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
--    row). Purged daily; the throttle only looks back an hour.
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

-- Called by the app after sign-in. A token identifies a device, so
-- whoever signs in on it takes it over. Keeps each user's 10 most
-- recent devices.
create or replace function register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = now();

  delete from push_tokens
  where user_id = auth.uid()
    and token not in (
      select token from push_tokens
      where user_id = auth.uid()
      order by updated_at desc
      limit 10
    );
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
create or replace function claim_notifications(p_kind text, p_ref uuid)
returns table (token text, car_id uuid, car_name text, actor_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_window interval;
begin
  v_window := case p_kind
    when 'invite' then interval '1 hour'
    when 'parked' then interval '2 minutes'
  end;
  if v_window is null then
    raise exception 'unknown notification kind: %', p_kind;
  end if;

  -- One claim at a time per event target, so concurrent webhook calls
  -- can't both pass the throttle check.
  perform pg_advisory_xact_lock(hashtext('notify:' || p_kind || ':' || p_ref::text));

  return query
  with candidates as (
    select cs.shared_with_user_id as recipient_id,
           c.id as car_id,
           c.name as car_name,
           coalesce(owner_profile.display_name, 'Someone') as actor_name
    from car_shares cs
    join cars c on c.id = cs.car_id
    left join profiles owner_profile on owner_profile.id = c.owner_id
    where p_kind = 'invite'
      and cs.id = p_ref
      and cs.status = 'pending'

    union all

    select np.user_id,
           c.id,
           c.name,
           coalesce(parker.display_name, 'Someone')
    from parking_locations pl
    join cars c on c.id = pl.car_id
    left join profiles parker on parker.id = pl.updated_by_user_id
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
  ),
  logged as (
    insert into notification_log (recipient_id, kind, car_id)
    select due.recipient_id, p_kind, due.car_id from due
    returning 1
  )
  select pt.token, due.car_id, due.car_name, due.actor_name
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
revoke all on function register_push_token(text, text)   from public, anon, authenticated;
revoke all on function unregister_push_token(text)       from public, anon, authenticated;
revoke all on function claim_notifications(text, uuid)   from public, anon, authenticated;
revoke all on function forget_push_tokens(text[])        from public, anon, authenticated;

grant execute on function register_push_token(text, text)   to authenticated;
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
    raise exception 'on_car_deleted webhook not found; create it first (Dashboard → Database → Webhooks)';
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
