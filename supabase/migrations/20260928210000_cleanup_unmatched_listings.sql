-- One-time cleanup: the runner used to persist every listing it scraped;
-- it now only stores listings that match at least one saved search (see
-- README, section "Co se ukládá do databáze"). This removes the ~1000
-- pre-existing rows that don't match any search.
--
-- price_history and matches both reference listings with `on delete
-- cascade` (see 20260928120000_init.sql), so deleting from listings alone
-- is sufficient to also remove their price history. No row currently in
-- matches is affected, since only unmatched listings are targeted.
delete from public.listings
where id not in (select distinct listing_id from public.matches);
