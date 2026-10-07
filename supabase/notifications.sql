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
--   * A generic "you've been invited to share a vehicle" to the
--     invitee when an invite is created (at most 5 a day).
--   * "<car> was parked" to the owner and accepted sharers who turned
--     it on for that car (car_notification_prefs), except whoever
--     parked it.
-- Notifications never include coordinates, and never carry text chosen
-- by someone the recipient hasn't accepted a share from (see
-- claim_notifications).
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
-- app install generated and keeps in its keychain; only its hash is stored.
-- A token that's already registered can only be moved to another account by
-- the same install, so knowing a device's token isn't enough to take over
-- its notifications. A different person signing in on the same phone is the
-- same install, so handing a phone over still works. The account a token
-- already belongs to may also re-register it from a new install (e.g. a lost
-- secret), so nobody gets locked out of their own device.
--
-- Known limit: whoever registers a token first owns it, so someone who knew
-- a device's token before that device registered could squat it (the owner
-- would then get no pushes; no data is exposed). Tokens never leave the
-- device except to Expo and this table, which no user can read. Closing
-- this fully needs proof of possession (a challenge push the device must
-- answer).
--
-- Returns false if the token belongs to another account's install. Keeps
-- each user's 10 most recent devices.
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
        device_secret_hash = excluded.device_secret_hash,
        updated_at = now()
    where push_tokens.device_secret_hash = excluded.device_secret_hash
       or push_tokens.user_id = auth.uid()
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
