-- ============================================================
-- Where'd We Park — Minimum supported app version
-- Idempotent: safe to run against an existing project.
-- Run this in the Supabase SQL Editor.
--
-- At launch, and whenever it returns to the foreground, the app
-- compares its build number with min_build for its platform. If it's
-- older, it shows a blocking "Update required" screen with a link to
-- store_url (see lib/app-version.ts). The build number is the iOS
-- CFBundleVersion or Android versionCode, shown in Settings → About.
-- Only builds that include this check honour it, so it has to ship
-- before it's needed.
--
-- Starts at 0 (nothing blocked). To require an update:
--   update app_min_versions
--   set min_build = <oldest build still allowed>, updated_at = now()
--   where platform = 'ios';
-- ============================================================

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
