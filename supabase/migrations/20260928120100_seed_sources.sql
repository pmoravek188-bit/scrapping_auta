-- Seed the sources registry. MVP sources are enabled; extra/best-guess
-- adapters are registered but disabled until verified against live sites.
insert into public.sources (id, name, enabled, needs_browser) values
  ('sauto', 'Sauto.cz', true, false),
  ('bazos', 'Bazoš (auto.bazos.cz)', true, false),
  ('tipcars', 'TipCars.com', true, false),
  ('carvago', 'Carvago.com', true, false),
  ('dasweltauto', 'Das WeltAuto', true, false),
  ('aaaauto', 'AAA Auto', true, false),
  ('havex', 'Havex.cz', false, false),
  ('autoesa', 'Auto ESA', false, false),
  ('skodaplus', 'Škoda Plus', false, false),
  ('autoscout24', 'AutoScout24', false, false)
on conflict (id) do update set
  name = excluded.name,
  needs_browser = excluded.needs_browser;
