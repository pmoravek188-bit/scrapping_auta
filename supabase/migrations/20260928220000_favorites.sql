-- Oblíbené (favourites) as a real per-user list, independent of any saved
-- search. Previously "favourite" was just `matches.status = 'favorite'`,
-- which only existed for a listing that matched one of the user's own saved
-- searches (the "Moje hledání" scope) — a listing found via "Všechna auta"
-- could never be favourited. This migration adds a standalone table and
-- backfills it from the old per-match flag; the UI fully migrates to this
-- table (see README.md "Oblíbené").

create table if not exists public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  note text,
  primary key (user_id, listing_id)
);

create index if not exists favorites_user_id_idx on public.favorites (user_id, created_at desc);
create index if not exists favorites_listing_id_idx on public.favorites (listing_id);

alter table public.favorites enable row level security;

create policy "favorites_select_own" on public.favorites
  for select using (user_id = (select auth.uid()));
create policy "favorites_insert_own" on public.favorites
  for insert with check (user_id = (select auth.uid()));
create policy "favorites_update_own" on public.favorites
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "favorites_delete_own" on public.favorites
  for delete using (user_id = (select auth.uid()));

comment on table public.favorites is
  'Per-user favourite listings, independent of matches/searches. A favourite that no longer matches any saved search keeps its last known state — the scraper only re-upserts listings that currently match a search (see README.md "Oblíbené"), but cleanupUnmatchedListings() in packages/scrapers/src/runner.ts never deletes a favourited listing.';
comment on column public.favorites.note is 'Optional free-text note the user attaches to a favourite (e.g. "zavolat prodejci").';

-- Backfill: every existing `matches.status = 'favorite'` becomes a row here,
-- owned by that match's search's user.
insert into public.favorites (user_id, listing_id)
select distinct s.user_id, m.listing_id
from public.matches m
join public.searches s on s.id = m.search_id
where m.status = 'favorite'
on conflict (user_id, listing_id) do nothing;
