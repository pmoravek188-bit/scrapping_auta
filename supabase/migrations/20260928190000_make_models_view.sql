-- View aggregating distinct make/model combinations from active listings.
-- Used by the web app to populate the "Model" select dropdown once a make is
-- chosen in the search filters (merged client-side with a small static
-- fallback list in packages/core so the dropdown isn't empty before the
-- scraper has found anything for a given make).
--
-- security_invoker = true: the view runs with the querying user's own
-- permissions (and RLS), not the view owner's — so it only ever surfaces
-- what `listings_select_authenticated` already allows an authenticated user
-- to read directly, i.e. no privilege escalation.
create or replace view public.make_models
with (security_invoker = true) as
select
  make,
  model,
  count(*)::bigint as listing_count
from public.listings
where is_active
  and make is not null
  and model is not null
group by make, model;

grant select on public.make_models to authenticated;
