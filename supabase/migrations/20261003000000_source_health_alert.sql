-- Source health alert: after a full scrape run, each enabled source's
-- `found` count this run is compared against the median of its last 5
-- *successful* runs (see packages/scrapers/src/health-alert.ts). A source
-- that returned 0 (or errored) while it usually finds several cars is
-- almost certainly broken (markup change, block, dead URL) rather than
-- genuinely having zero matching cars right now — worth an e-mail + push
-- alert rather than silently sitting there finding nothing forever.
--
-- `last_alert_at` rate-limits that alert to at most one per source per 24h
-- (see shouldAlertSource in health-alert.ts) — without it, a source stuck
-- broken for days would re-alert on every single run.
alter table public.sources add column if not exists last_alert_at timestamptz;

comment on column public.sources.last_alert_at is
  'Last time a "source stopped returning cars" alert was sent for this source (see packages/scrapers/src/health-alert.ts). Rate-limits the alert to at most once per 24h per source.';
