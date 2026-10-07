-- Adds autobazar.eu (autobazar.cz 301-redirects to the same site — one
-- source, not two), verified live 2026-10-07 against
-- `https://www.autobazar.eu/cs/vysledky/osobne-vozidla/` (see
-- packages/scrapers/src/sources/autobazar.ts's top-of-file comment for the
-- full research/verification notes). Enabled: the adapter has confirmed
-- working server-side make/model/year/price/mileage filters and a
-- blocked-page detector (`looksLikeAutobazarListingPage`) that throws
-- instead of silently reporting zero results, matching this app's bar for
-- "verified" sources (sauto/aaaauto/autoscout24/etc). Whether it survives
-- sustained traffic from a shared GitHub Actions IP (vs. this adapter's own
-- research probing, which did get rate-limited/blocked after a burst of
-- requests — see the adapter file header) can only be confirmed by an
-- actual GitHub Actions run.
insert into public.sources (id, name, enabled) values
  ('autobazar', 'Autobazar.eu', true)
on conflict (id) do nothing;
