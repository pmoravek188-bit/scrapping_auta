-- Web Push (VAPID) support for the installed PWA — see README "Web Push"
-- and apps/web/lib/push.ts / apps/web/public/sw.js / packages/scrapers/src/push.ts.
--
-- push_subscriptions: one row per browser/device subscription a user has
-- registered (PushManager.subscribe()). A user can have several (phone +
-- laptop, several browsers, ...). RLS: a user can only see/manage their own
-- rows — the runner reads/writes across all users via the service-role key,
-- which bypasses RLS entirely.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (user_id = (select auth.uid()));
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert with check (user_id = (select auth.uid()));
create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete using (user_id = (select auth.uid()));

comment on table public.push_subscriptions is
  'Web Push subscriptions (PushManager.subscribe() results) registered by users via the "Notifikace" toggle. A dead subscription (push send returns 404/410) is deleted by the runner (see packages/scrapers/src/push.ts).';

-- app_secrets: tiny service-role-only key/value store for secrets that
-- can't be new GitHub Actions / Vercel env vars (none may be added — see
-- README). RLS is enabled with NO policies at all, so only the service_role
-- key (which bypasses RLS) can ever read or write it — no authenticated
-- user, however they're signed in, can select from this table.
--
-- This migration intentionally does NOT insert any secret values — the
-- operator runs that insert manually after generating a VAPID key pair
-- (`npx web-push generate-vapid-keys`), see README "Web Push".
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

alter table public.app_secrets enable row level security;

comment on table public.app_secrets is
  'Service-role-only secrets (no RLS policies at all — not even an authenticated-read one). Holds vapid_public_key / vapid_private_key / vapid_subject for Web Push (see packages/scrapers/src/push.ts). Never insert secret values via a migration file; set them manually with a direct SQL insert run once against the project.';
