-- Manual per-user scrape runs ("Spustit scraping mých hledání"): a
-- workflow_dispatch run with a `user_id` input (see .github/workflows/
-- scrape.yml and packages/scrapers/src/runner.ts's `--user=<uuid>`) only
-- processes that one user's enabled searches and notifies only them —
-- see runner.ts's RunOptions.userFilter for the full behavior.

-- 1. scrape_runs.user_id: nullable tag marking a scrape_runs row as
--    belonging to a user-scoped manual run rather than the regular cron run
--    (NULL = global/cron, same as every row before this migration). The
--    health watchdog (packages/scrapers/src/health-alert.ts) and the "Stav
--    zdrojů" status page (apps/web/app/sources/page.tsx) both filter
--    `.is("user_id", null)` so a partial, single-user run's numbers never
--    pollute source-health history computed from full runs.
alter table public.scrape_runs
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists scrape_runs_user_id_idx
  on public.scrape_runs (user_id) where user_id is not null;

-- 2. manual_scrape_requests: rate-limit bookkeeping for the "Spustit
--    scraping mých hledání" button — one manual run per user per 2 hours,
--    enforced server-side in apps/web/app/api/scrape/route.ts (never trust
--    a client-supplied cooldown/user id). RLS: a user can only insert/select
--    their own rows — enough for the route (running with the user's own
--    session) to check/record their own last request, same pattern as
--    app_admins (see 20261005000000_app_admins.sql).
create table if not exists public.manual_scrape_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text,
  requested_at timestamptz not null default now()
);

create index if not exists manual_scrape_requests_user_id_idx
  on public.manual_scrape_requests (user_id, requested_at desc);

alter table public.manual_scrape_requests enable row level security;

create policy "manual_scrape_requests_select_own" on public.manual_scrape_requests
  for select using (user_id = (select auth.uid()));
create policy "manual_scrape_requests_insert_own" on public.manual_scrape_requests
  for insert with check (user_id = (select auth.uid()));

comment on table public.manual_scrape_requests is
  'Rate-limit bookkeeping for the manual "Spustit scraping mých hledání" button: one row per manual trigger, used to enforce one run per user per 2 hours server-side (apps/web/app/api/scrape/route.ts). RLS: a user can only see/insert their own rows.';
