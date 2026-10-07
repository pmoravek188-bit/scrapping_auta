-- Multi-user fix for "Vše" on /results: this scope previously scanned
-- public.listings directly for ANY active listing, regardless of who it
-- matched -- so one user's "Vše" included listings that only matched a
-- DIFFERENT user's saved searches. "Vše" is redefined here to mean "every
-- active listing with a non-hidden match in one of MY OWN searches" --
-- i.e. the union of what every one of "Moje hledání: <name>" chip would
-- show, deduped by group_id exactly like before.
--
-- Same signature/return type as the original (supabase/migrations/
-- 20260928200000_results_rework.sql) -- create or replace is enough, no
-- drop needed. Still security invoker: this only ever sees rows the
-- calling user's own RLS already allows.
--
-- Visibility is computed in its own CTE via EXISTS (not a join) precisely
-- so it can't multiply `base` rows when a listing matches more than one of
-- the caller's own searches at once -- a join here would inflate
-- group_offer_count (which counts base rows per group) and could duplicate
-- a listing on the page. The left join to `matches` further down is
-- unchanged from the original: it only ever populates match_id/match_status
-- for the "Moje hledání: <name>" scope (p_search_id not null), exactly as
-- before -- "Vše" still exposes match_id/match_status as null.
create or replace function public.search_listings(
  p_search_id uuid default null,
  p_make text default null,
  p_model text default null,
  p_price_from integer default null,
  p_price_to integer default null,
  p_year_from integer default null,
  p_year_to integer default null,
  p_mileage_max integer default null,
  p_power_min_kw integer default null,
  p_fuel text[] default null,
  p_body text[] default null,
  p_transmission text default null,
  p_sources text[] default null,
  p_drive text[] default null,
  p_text_terms text[] default null,
  p_only_new boolean default false,
  p_seen_prev timestamptz default null,
  p_sort text default 'newest',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  source text,
  source_id text,
  url text,
  title text,
  make text,
  model text,
  variant text,
  year integer,
  mileage_km integer,
  price_czk integer,
  price_orig numeric,
  currency_orig text,
  fuel text,
  transmission text,
  power_kw integer,
  body text,
  color text,
  location text,
  country text,
  seller_type text,
  vin text,
  image_urls text[],
  drive text,
  equipment text[],
  first_seen timestamptz,
  last_seen timestamptz,
  is_active boolean,
  fingerprint text,
  group_id uuid,
  created_at timestamptz,
  match_id uuid,
  match_status text,
  group_offer_count bigint,
  is_new boolean,
  total_count bigint
)
language sql
security invoker
stable
as $$
  with visible as (
    select l.*
    from public.listings l
    where l.is_active
      and (
        (
          p_search_id is not null
          and exists (
            select 1 from public.matches m
            where m.listing_id = l.id
              and m.search_id = p_search_id
              and m.status <> 'hidden'
          )
        )
        or (
          p_search_id is null
          and exists (
            select 1
            from public.matches m
            join public.searches s on s.id = m.search_id
            where m.listing_id = l.id
              and s.user_id = (select auth.uid())
              and m.status <> 'hidden'
          )
        )
      )
  ),
  base as (
    select
      v.*,
      m.id as match_id,
      m.status as match_status,
      m.matched_at as match_matched_at
    from visible v
    left join public.matches m
      on p_search_id is not null and m.listing_id = v.id and m.search_id = p_search_id
    where (p_make is null or v.make = p_make)
      and (p_model is null or v.model = p_model or v.model like (p_model || '-%'))
      and (p_price_from is null or v.price_czk >= p_price_from)
      and (p_price_to is null or v.price_czk <= p_price_to)
      and (p_year_from is null or v.year >= p_year_from)
      and (p_year_to is null or v.year <= p_year_to)
      and (p_mileage_max is null or v.mileage_km <= p_mileage_max)
      and (p_power_min_kw is null or v.power_kw >= p_power_min_kw)
      and (p_fuel is null or array_length(p_fuel, 1) is null or v.fuel is null or v.fuel = any (p_fuel))
      and (p_body is null or array_length(p_body, 1) is null or v.body is null or v.body = any (p_body))
      and (p_transmission is null or v.transmission is null or v.transmission = p_transmission)
      and (p_sources is null or array_length(p_sources, 1) is null or v.source = any (p_sources))
      and (p_drive is null or array_length(p_drive, 1) is null or (v.drive is not null and v.drive = any (p_drive)))
      and (
        p_text_terms is null or array_length(p_text_terms, 1) is null or exists (
          select 1 from unnest(p_text_terms) as t(term)
          where v.title ilike ('%' || t.term || '%')
            or v.variant ilike ('%' || t.term || '%')
            or exists (select 1 from unnest(v.equipment) as e(val) where e.val ilike ('%' || t.term || '%'))
        )
      )
  ),
  counts as (
    select coalesce(group_id, id) as gkey, count(*)::bigint as group_offer_count
    from base
    group by 1
  ),
  cheapest as (
    select distinct on (coalesce(b.group_id, b.id)) b.*
    from base b
    order by coalesce(b.group_id, b.id), b.price_czk asc nulls last, b.last_seen desc
  ),
  combined as (
    select
      c.*,
      cn.group_offer_count,
      case
        when p_seen_prev is null then false
        when p_search_id is not null then coalesce(c.match_matched_at, c.first_seen) > p_seen_prev
        else c.first_seen > p_seen_prev
      end as is_new
    from cheapest c
    join counts cn on cn.gkey = coalesce(c.group_id, c.id)
  ),
  final as (
    select * from combined
    where (not p_only_new) or is_new
  )
  select
    final.id, final.source, final.source_id, final.url, final.title, final.make, final.model,
    final.variant, final.year, final.mileage_km, final.price_czk, final.price_orig,
    final.currency_orig, final.fuel, final.transmission, final.power_kw, final.body, final.color,
    final.location, final.country, final.seller_type, final.vin, final.image_urls, final.drive,
    final.equipment, final.first_seen, final.last_seen, final.is_active, final.fingerprint,
    final.group_id, final.created_at, final.match_id, final.match_status,
    final.group_offer_count, final.is_new,
    count(*) over ()::bigint as total_count
  from final
  order by
    case when p_sort = 'price_asc' then final.price_czk end asc nulls last,
    case when p_sort = 'price_desc' then final.price_czk end desc nulls last,
    case when p_sort = 'year_desc' then final.year end desc nulls last,
    case when p_sort = 'mileage_asc' then final.mileage_km end asc nulls last,
    final.last_seen desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

revoke execute on function public.search_listings(
  uuid, text, text, integer, integer, integer, integer, integer, integer, text[], text[], text,
  text[], text[], text[], boolean, timestamptz, text, integer, integer
) from public, anon;
grant execute on function public.search_listings(
  uuid, text, text, integer, integer, integer, integer, integer, integer, text[], text[], text,
  text[], text[], text[], boolean, timestamptz, text, integer, integer
) to authenticated;

comment on function public.search_listings is
  'Security-invoker paginated/deduped listing search backing /results. "Vse" (p_search_id null) now means "every active listing matched by one of MY OWN searches", not every active listing in the DB -- see README.md "Scope vysledku".';
