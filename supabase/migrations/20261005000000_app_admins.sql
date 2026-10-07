-- Admin notion, introduced without any new secrets: a tiny table marking
-- which auth.users are "admins" of this app (currently: can trigger a
-- scrape run from the web UI, and receive source-health push alerts — see
-- apps/web/app/api/scrape/route.ts and packages/scrapers/src/push.ts's
-- sendPushToAdmins/loadAdminUserIds).
--
-- RLS: a signed-in user can only ever select THEIR OWN row — enough for the
-- web app to answer "am I an admin?" (a query filtered to auth.uid() either
-- returns a row or doesn't), but never enough to enumerate who else is an
-- admin. The service-role runner bypasses RLS entirely, same as every other
-- table it reads.
--
-- This migration is intentionally additive-only and does NOT seed any row —
-- the operator inserts the first admin manually (the id is data, not
-- schema): see the SQL in the task report for the exact one-line insert.
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.app_admins enable row level security;

create policy "app_admins_select_own" on public.app_admins
  for select using (user_id = (select auth.uid()));

comment on table public.app_admins is
  'Marks which auth.users are app admins (can trigger a scrape run; receive source-health push alerts). RLS only lets a user see their OWN row. Seed the first admin manually: insert into app_admins select id from auth.users where email = ''<admin email>'' — never via a migration (the id is data, not schema).';
