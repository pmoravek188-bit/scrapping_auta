-- "Smazané inzeráty" (gone listings): instead of only flipping
-- `is_active = false` after a listing hasn't been seen for a few days, the
-- runner now confirms a listing is actually gone from its source (detail
-- page 404/410, redirected to a list/search page, or a "byl smazán/prodán"
-- style message — see packages/scrapers/src/gone-detection.ts) and deletes
-- it outright, UNLESS it's in someone's favourites (public.favorites).
--
-- A favourited listing that's confirmed gone is kept, but flagged with
-- `gone_at` (marks it deactivated + records when) so the Oblíbené page can
-- show "Prodáno / nedostupné od <datum>" instead of silently losing it —
-- and so it can be swept up automatically once the user has had a chance to
-- see that. See README.md "Smazané inzeráty".
alter table public.listings add column if not exists gone_at timestamptz;

comment on column public.listings.gone_at is
  'Set when a listing was confirmed gone from its source (see packages/scrapers/src/gone-detection.ts) while it was still in someone''s favorites, so it was kept (is_active=false) instead of deleted. Null otherwise. The web app shows "Prodáno / nedostupné od <gone_at>" on such a favourite.';

create index if not exists listings_gone_at_idx on public.listings (gone_at) where gone_at is not null;
