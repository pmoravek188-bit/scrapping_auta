-- Favourites alerts tracking (see packages/scrapers/src/favorites-alert.ts):
-- notifies a favourite's owner when it drops in price or becomes gone, while
-- never re-notifying the exact same event twice.
--
-- `last_notified_price`: the price (CZK) this favourite was last notified
-- about (or just seen at, if it was never actually a drop). Null on a fresh
-- favourite — seeded to the current price on first sight without alerting
-- (nothing to compare against yet).
-- `last_notified_gone_at`: set once a gone listing has been alerted on for
-- this favourite; cleared again if the listing becomes active (so a later
-- re-confirmed "gone" can alert again).
alter table public.favorites add column if not exists last_notified_price integer;
alter table public.favorites add column if not exists last_notified_gone_at timestamptz;

comment on column public.favorites.last_notified_price is
  'Price (CZK) this favourite was last notified about (or just seen at). Seeded to the listing''s current price on first sight without alerting. See packages/scrapers/src/favorites-alert.ts.';
comment on column public.favorites.last_notified_gone_at is
  'Set once a "this favourite is gone" alert was sent for the listing''s current gone_at; cleared if the listing becomes active again. See packages/scrapers/src/favorites-alert.ts.';
