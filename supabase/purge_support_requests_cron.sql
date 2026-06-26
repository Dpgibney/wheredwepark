-- ============================================================
-- Where'd We Park — Support requests (Contact Us / Report a Problem)
-- Single-run migration: creates the support_requests table that backs the
-- contact-support edge function (durable record + per-user rate limiting),
-- then schedules a daily pg_cron job to purge old rows.
-- Run in the Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- Table: support_requests
-- ------------------------------------------------------------

create table if not exists support_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade not null,
  subject       text not null check (char_length(subject) <= 200),
  message       text not null check (char_length(message) <= 5000),
  contact_email text check (char_length(contact_email) <= 320),
  platform      text check (char_length(platform) <= 100),
  created_at    timestamptz default now() not null
);

-- Supports the rate-limit lookup (one user's rows within the last hour).
create index if not exists support_requests_user_created_idx
  on support_requests (user_id, created_at desc);

-- Every read/write goes through the service-role contact-support edge function,
-- which bypasses RLS. Enabling RLS with NO policies denies all direct client
-- access, countering the schema-wide `grant all on all tables to authenticated`.
alter table support_requests enable row level security;

-- The contact-support edge function reads/writes this table as the service_role.
-- This project's grants are authenticated-only (see top of schema.sql), so
-- without USAGE on the schema service_role can't even see the table ("relation
-- does not exist"), and without the table grant its queries are denied.
grant usage on schema public to service_role;
grant select, insert on support_requests to service_role;

-- ------------------------------------------------------------
-- Scheduled purge: drop rows older than 30 days, daily at 04:00 UTC.
-- The rate limiter only looks back 1 hour, so nothing older is needed.
-- ------------------------------------------------------------

-- pg_cron creates and uses the `cron` schema. Safe to re-run.
create extension if not exists pg_cron;

-- Scheduling by name is an upsert in pg_cron, so re-running this updates the
-- existing job rather than creating a duplicate.
select cron.schedule(
  'purge-old-support-requests',
  '0 4 * * *',
  $$ delete from public.support_requests where created_at < now() - interval '30 days' $$
);

-- Inspect with:   select * from cron.job where jobname = 'purge-old-support-requests';
-- Remove with:    select cron.unschedule('purge-old-support-requests');
