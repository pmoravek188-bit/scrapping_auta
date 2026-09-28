-- Adds drive-type ("Pohon": 4x4/AWD, přední, zadní) and equipment/"Verze"
-- chip support (packages/core's DRIVE_TYPES / FEATURE_GROUPS / VERSION_GROUPS).
--
-- listings.drive / listings.equipment are populated by the scraper
-- (packages/scrapers/src/runner.ts) from packages/core's `normalizeListing`
-- (structured source field when available, else inferred from title/variant
-- text — see packages/core/src/infer.ts's `inferDrive`).
--
-- searches.drive / searches.features are the saved-search filter values; the
-- web app writes these directly (no server-side normalization needed beyond
-- what packages/core's SearchQuerySchema already validates) and
-- packages/scrapers/src/runner.ts's `toSearchQuery` maps them straight
-- through to `matchesSearch`.
--
-- No RLS changes needed: these are plain columns on tables that already have
-- RLS policies from 20260928120000_init.sql (listings: authenticated
-- read-only; searches: owner read/write via user_id = auth.uid()).

alter table public.listings
  add column if not exists drive text,
  add column if not exists equipment text[] not null default '{}';

alter table public.searches
  add column if not exists drive text[] not null default '{}',
  add column if not exists features text[] not null default '{}';

comment on column public.listings.drive is
  'Drive type: awd | fwd | rwd | null (unknown). See packages/core DRIVE_TYPES.';
comment on column public.listings.equipment is
  'Free-text equipment labels from sources that expose them cheaply (e.g. carvago catalog_features) — used only to improve "Výbava" feature-chip matching against title/variant/equipment text, not a filter dimension of its own.';
comment on column public.searches.drive is
  'Ticked "Pohon" chips (subset of awd/fwd/rwd). Empty = any.';
comment on column public.searches.features is
  'Ticked "Výbava"/"Verze" chip ids (packages/core FEATURE_GROUPS + VERSION_GROUPS, e.g. "tazne", "prodlouzena"). Empty = any.';
