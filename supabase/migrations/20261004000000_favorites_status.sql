-- Favourite status ("Nekontaktováno" / "Volal jsem" / "Prohlídka" /
-- "Zamítnuto" / "Koupeno") — a per-favourite pipeline the user can set on
-- /favorites and the listing detail page. Purely additive: a new column with
-- a safe default, no backfill needed (every existing favourite simply starts
-- as 'none' = "Nekontaktováno"). RLS update of own favourites.* columns
-- (including this one) is already covered by "favorites_update_own" from
-- supabase/migrations/20260928220000_favorites.sql.
alter table public.favorites
  add column if not exists status text not null default 'none';

alter table public.favorites
  drop constraint if exists favorites_status_check;
alter table public.favorites
  add constraint favorites_status_check
  check (status in ('none', 'volal', 'prohlidka', 'zamitnuto', 'koupeno'));

create index if not exists favorites_status_idx on public.favorites (user_id, status);

comment on column public.favorites.status is
  'Per-favourite contact/decision pipeline: none ("Nekontaktováno"), volal ("Volal jsem"), prohlidka ("Prohlídka"), zamitnuto ("Zamítnuto"), koupeno ("Koupeno"). Czech labels live in apps/web/lib/format.ts (FAVORITE_STATUS_LABELS).';
