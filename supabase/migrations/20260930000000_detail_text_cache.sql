-- Detail-page enrichment for near-match listings (see
-- packages/scrapers/src/runner.ts): a listing that fails matching a saved
-- search ONLY on a feature/version chip (e.g. "prodloužená verze"/long
-- wheelbase) often mentions it only in the source's DETAIL page text
-- (description/equipment/wheelbase), not the list page the scraper normally
-- reads. The runner fetches that detail text (via each adapter's optional
-- `fetchDetailText`, capped per source per run) and re-runs feature
-- detection against title+variant+equipment+detail text.
--
--   * public.detail_text_cache -- avoids re-fetching the same listing's
--                                  detail page every run; re-fetched after 14
--                                  days (see MAX_DETAIL_CACHE_AGE_DAYS in
--                                  runner.ts) in case equipment text changes.
--   * public.listings.detail_features -- the feature-group ids (core's
--                                  FEATURE_GROUPS/VERSION_GROUPS) confirmed
--                                  present by that detail-text scan, stored
--                                  on the listing itself so BOTH the nightly
--                                  scraper's matching (packages/core's
--                                  matcher.ts) and the web app's instant
--                                  rematch (apps/web/app/actions/rematch.ts)
--                                  see it without re-fetching any detail page.

create table if not exists public.detail_text_cache (
  source text not null,
  source_id text not null,
  features text[] not null default '{}',
  fetched_at timestamptz not null default now(),
  primary key (source, source_id)
);

alter table public.detail_text_cache enable row level security;
-- No policies: this cache is written/read exclusively by the scraper
-- runner's service_role client, which bypasses RLS entirely. Deliberately no
-- grants to `anon`/`authenticated` — it holds no user data, but there's no
-- reason for the web app to touch it either, so it stays service-role-only
-- by omission (same pattern as `scrape_runs`/`exchange_rates` writes).

comment on table public.detail_text_cache is
  'Per-(source, source_id) cache of feature-group ids detected from a listing''s DETAIL page text (description/equipment/wheelbase), so the runner''s near-match enrichment pass (see runner.ts) doesn''t re-fetch the same listing''s detail page every run. Re-fetched after ~14 days. Service-role only (RLS enabled, no policies).';
comment on column public.detail_text_cache.features is
  'Feature-group ids (core''s FEATURE_GROUPS/VERSION_GROUPS, e.g. "prodlouzena") detected in the listing''s detail-page text at fetched_at. Empty array is a valid, meaningful result (fetched but nothing matched) distinct from "never fetched" (no row).';

alter table public.listings
  add column if not exists detail_features text[] not null default '{}';

comment on column public.listings.detail_features is
  'Feature-group ids confirmed by the runner''s detail-page enrichment pass (see public.detail_text_cache and packages/scrapers/src/runner.ts) — distinct from `equipment` (free text from the LIST page only). packages/core''s hasAllFeatures/matchesSearch and apps/web''s rematchSearch both treat an id present here as satisfied without re-scanning title/variant/equipment text. Empty for the overwhelming majority of listings (only near-matches ever get a detail fetch).';
