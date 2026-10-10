-- Real (seller-side) price changes vs EUR/CZK conversion noise.
--
-- Verified in prod: for EUR-priced sources (autoscout24, carvago, autobazar
-- -- listings.currency_orig = 'EUR', listings.price_orig = EUR amount), the
-- runner recomputes price_czk from price_orig with THAT RUN's EUR/CZK rate
-- every time (see packages/scrapers/src/runner.ts), so price_history gets a
-- new row -- and gets counted as a "price change" -- even when the seller
-- never touched the price. autoscout24 had 6,014 price_history changes, of
-- which 5,645 (94%) were <= 3,000 Kc; carvago 2,544, of which 2,375 (93%)
-- were <= 3,000 Kc. CZK-native sources (sauto, tipcars, ...) never had this
-- problem and have real changes averaging 25,000-31,000 Kc.
--
-- Fix, part 1 (this migration): from now on, price_history also carries the
-- ORIGINAL (seller-listed) price/currency alongside the CZK snapshot, so a
-- genuine seller price change can be told apart from FX noise by comparing
-- price_orig directly instead of price_czk. Nullable/additive -- existing
-- rows stay null (legacy); packages/core/src/price-changes.ts's
-- realPriceChanges() falls back to a tolerance-based heuristic for those.
--
-- Fix, part 2 (this migration): the runner (packages/scrapers/src/
-- runner.ts) now only INSERTs a new price_history row when price_orig
-- itself changed (for a CZK-native listing, price_orig IS price_czk, so
-- behaviour there is unchanged) -- a same-price EUR listing whose price_czk
-- moved purely from the day's rate no longer writes a row at all.
--
-- Fix, part 3: packages/scrapers/src/favorites-alert.ts now compares a
-- favourite's price_orig (tracked in the new last_notified_price_orig
-- column below) instead of price_czk, so an EUR-priced favourite's alert is
-- unaffected by EUR/CZK rate movement either.
alter table public.price_history add column if not exists price_orig numeric;
alter table public.price_history add column if not exists currency_orig text;

comment on column public.price_history.price_orig is
  'Original listing price in currency_orig at the time this row was recorded. Null for rows written before this column existed (legacy) -- see packages/core/src/price-changes.ts realPriceChanges().';
comment on column public.price_history.currency_orig is
  'Currency of price_orig (e.g. CZK, EUR) at the time this row was recorded. Null for legacy rows.';

alter table public.favorites add column if not exists last_notified_price_orig numeric;

comment on column public.favorites.last_notified_price_orig is
  'Original-currency price (listings.price_orig) this favourite was last notified about (or just seen at). Used instead of last_notified_price for the actual drop/rise decision, so an EUR-priced favourite''s alert is unaffected by EUR/CZK rate movement. See packages/scrapers/src/favorites-alert.ts.';
