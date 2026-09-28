-- havex, autoesa and skodaplus were verified live against the real sites on
-- 2026-09-28 (see packages/scrapers/src/sources/*.ts top-of-file comments)
-- and are enabled here. autoscout24 was also verified and rewritten to
-- search Germany only (cy=D) with EUR->CZK price conversion (incl. VAT) per
-- explicit user decision, and is enabled too.
update public.sources
set enabled = true
where id in ('havex', 'autoesa', 'skodaplus', 'autoscout24');
