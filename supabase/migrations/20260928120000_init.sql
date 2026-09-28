-- Initial schema for scrapping-auta: sources, searches, listings,
-- price_history, matches, scrape_runs, exchange_rates + RLS.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- sources: registry of scraper adapters and their last run status
-- ---------------------------------------------------------------------------
create table if not exists public.sources (
  id text primary key,
  name text not null,
  enabled boolean not null default true,
  needs_browser boolean not null default false,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_count integer,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- searches: saved search criteria owned by a user
-- ---------------------------------------------------------------------------
create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  make text,
  model text,
  year_from integer,
  year_to integer,
  price_from integer,
  price_to integer,
  mileage_max integer,
  fuel text[] not null default '{}',
  transmission text,
  body text[] not null default '{}',
  power_min_kw integer,
  keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  sources text[] not null default '{}',
  notify boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists searches_user_id_idx on public.searches (user_id);
create index if not exists searches_enabled_idx on public.searches (enabled) where enabled;

-- ---------------------------------------------------------------------------
-- listings: normalized listing scraped from a source
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.sources (id),
  source_id text not null,
  url text not null,
  title text not null default '',
  make text,
  model text,
  variant text,
  year integer,
  mileage_km integer,
  price_czk integer,
  price_orig numeric,
  currency_orig text not null default 'CZK',
  fuel text,
  transmission text,
  power_kw integer,
  body text,
  color text,
  location text,
  country text not null default 'CZ',
  seller_type text not null default 'unknown',
  vin text,
  image_urls text[] not null default '{}',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  is_active boolean not null default true,
  fingerprint text not null,
  group_id uuid,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists listings_make_model_idx on public.listings (make, model);
create index if not exists listings_group_id_idx on public.listings (group_id);
create index if not exists listings_fingerprint_idx on public.listings (fingerprint);
create index if not exists listings_is_active_idx on public.listings (is_active) where is_active;
create index if not exists listings_last_seen_idx on public.listings (last_seen desc);

-- ---------------------------------------------------------------------------
-- price_history: append-only log of price_czk changes for a listing
-- ---------------------------------------------------------------------------
create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings (id) on delete cascade,
  price_czk integer,
  seen_at timestamptz not null default now()
);

create index if not exists price_history_listing_id_idx on public.price_history (listing_id, seen_at desc);

-- ---------------------------------------------------------------------------
-- matches: link between a search and a listing that satisfies it
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  matched_at timestamptz not null default now(),
  notified_at timestamptz,
  status text not null default 'new',
  unique (search_id, listing_id)
);

create index if not exists matches_search_id_idx on public.matches (search_id);
create index if not exists matches_listing_id_idx on public.matches (listing_id);
create index if not exists matches_notified_idx on public.matches (notified_at) where notified_at is null;

-- ---------------------------------------------------------------------------
-- scrape_runs: one row per source per scraper run, for the "sources" status page
-- ---------------------------------------------------------------------------
create table if not exists public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  found integer not null default 0,
  new integer not null default 0,
  errors text,
  created_at timestamptz not null default now()
);

create index if not exists scrape_runs_source_idx on public.scrape_runs (source, started_at desc);

-- ---------------------------------------------------------------------------
-- exchange_rates: daily EUR/CZK rate (CNB)
-- ---------------------------------------------------------------------------
create table if not exists public.exchange_rates (
  rate_date date primary key,
  eur_czk numeric not null
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.searches enable row level security;
alter table public.matches enable row level security;
alter table public.listings enable row level security;
alter table public.price_history enable row level security;
alter table public.sources enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.exchange_rates enable row level security;

-- searches: user can fully manage their own rows only
create policy "searches_select_own" on public.searches
  for select using ((select auth.uid()) = user_id);
create policy "searches_insert_own" on public.searches
  for insert with check ((select auth.uid()) = user_id);
create policy "searches_update_own" on public.searches
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "searches_delete_own" on public.searches
  for delete using ((select auth.uid()) = user_id);

-- matches: user can manage matches belonging to their own searches
create policy "matches_select_own" on public.matches
  for select using (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );
create policy "matches_update_own" on public.matches
  for update using (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );
create policy "matches_delete_own" on public.matches
  for delete using (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );
-- no insert policy for matches: only the runner (service_role) creates matches

-- listings / price_history / sources / scrape_runs / exchange_rates:
-- read-only for any authenticated user, writes only via service_role
-- (service_role bypasses RLS entirely, so no insert/update/delete policies needed)
create policy "listings_select_authenticated" on public.listings
  for select using ((select auth.role()) = 'authenticated');
create policy "price_history_select_authenticated" on public.price_history
  for select using ((select auth.role()) = 'authenticated');
create policy "sources_select_authenticated" on public.sources
  for select using ((select auth.role()) = 'authenticated');
create policy "scrape_runs_select_authenticated" on public.scrape_runs
  for select using ((select auth.role()) = 'authenticated');
create policy "exchange_rates_select_authenticated" on public.exchange_rates
  for select using ((select auth.role()) = 'authenticated');
