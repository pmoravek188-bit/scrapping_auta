-- Adds two Czech multi-brand dealer-group sources, each scraping the
-- dealer's OWN used-car stock (not an aggregator):
--
-- - autojarov (Auto Jarov, autojarov.cz): Škoda/VW-Group + Honda franchise
--   dealer in Prague (Jarov/Kunratice); ~700 used cars in its own stock.
--   Notably lists Volkswagen commercial/leisure models (Multivan, Caddy
--   Maxi, California, ...) under a separate "Volkswagen Užitkové vozy"
--   brand page, which the adapter queries alongside plain Volkswagen — see
--   packages/scrapers/src/sources/autojarov.ts's file header.
-- - autopalace (Auto Palace Group, autopalace.cz): AutoBinck-owned
--   multi-brand dealer group (Ford/Hyundai/Mazda/MG/Opel/Peugeot/Škoda/
--   Volvo/Cupra franchises + wide multi-brand trade-in stock, incl. BMW);
--   552 used cars in its own stock at verification time.
--
-- Both verified live 2026-10-08 against their real search-results pages
-- (`/nabidka-vozu/typy_ojete/` and `/skladove-vozy/typy_ojete/`
-- respectively), with confirmed working server-side brand filters and a
-- blocked-page detector that throws instead of silently reporting zero
-- results, matching this app's bar for "verified" sources. Neither site
-- showed any Cloudflare/JS-challenge anti-bot during verification (plain
-- nginx/Nette server-rendered HTML) — see each adapter file's header for
-- the full research notes.
insert into public.sources (id, name, enabled) values
  ('autojarov', 'Auto Jarov', true),
  ('autopalace', 'Auto Palace', true)
on conflict (id) do nothing;
