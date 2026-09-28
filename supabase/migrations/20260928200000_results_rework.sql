-- Results-page rework:
--   * public.user_state       -- per-user "last visited /results" bookkeeping for "NOVÉ" badges
--   * matches RLS              -- owner-only insert/delete, needed by the instant-rematch server
--                                  action (apps/web/app/actions/rematch.ts), which now runs with
--                                  the signed-in user's own Supabase session, not service_role
--   * public.search_listings   -- security-invoker RPC used by /results for BOTH scopes
--                                  ("Všechna auta" and "Moje hledání: <name>"): applies every
--                                  cheap/DB-safe filter, dedupes by group_id (cheapest offer per
--                                  group), flags "is_new", sorts and paginates, all in one
--                                  accurate COUNT(*) OVER() pass. See README.md "Scope výsledků".
--
-- Every view/function here is security invoker (the default for functions;
-- stated explicitly for clarity) so it only ever sees rows the calling user's
-- own RLS already allows — no privilege escalation versus querying the base
-- tables directly.

-- ---------------------------------------------------------------------------
-- user_state: bookkeeping for the "NOVÉ" badge and the results-seen watermark
-- ---------------------------------------------------------------------------
create table if not exists public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  results_seen_at timestamptz,
  results_seen_prev timestamptz
);

alter table public.user_state enable row level security;

create policy "user_state_select_own" on public.user_state
  for select using (user_id = (select auth.uid()));
create policy "user_state_insert_own" on public.user_state
  for insert with check (user_id = (select auth.uid()));
create policy "user_state_update_own" on public.user_state
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.user_state is
  'One row per user. results_seen_prev is the watermark used to compute the "NOVÉ" badge (a listing/match newer than it is new); results_seen_at is when the visit that will become the next results_seen_prev started. See README.md "NOVÉ" pro přesnou logiku.';

-- ---------------------------------------------------------------------------
-- matches: owner-only insert/delete, for the instant-rematch server action
-- ---------------------------------------------------------------------------
-- 20260928120000_init.sql only granted select/update on matches to the
-- search's owner (rows were only ever written by the service_role scraper
-- runner, which bypasses RLS). The instant-rematch server action
-- (apps/web/app/actions/rematch.ts) now runs as the signed-in user via the
-- normal anon-key + session Supabase client, so it needs explicit owner-only
-- insert/delete policies too.
create policy "matches_insert_own" on public.matches
  for insert with check (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );
create policy "matches_delete_own_rematch" on public.matches
  for delete using (
    exists (select 1 from public.searches s where s.id = search_id and s.user_id = (select auth.uid()))
  );
-- (matches_delete_own from 20260928120000_init.sql already covers "hide a
-- match" style deletes by owner; this migration doesn't need to touch it.
-- Two delete policies on the same table are OR'd together by Postgres, so
-- this is redundant-but-harmless rather than conflicting.)

-- ---------------------------------------------------------------------------
-- search_listings: unified, paginated, deduped listing search
-- ---------------------------------------------------------------------------
-- Scope:
--   p_search_id is null      -> "Všechna auta": scans public.listings directly
--   p_search_id is not null  -> "Moje hledání: <name>": scans that search's
--                                public.matches (status <> 'hidden'); RLS on
--                                matches (owner-only select) means a caller
--                                can only ever pass a search_id they own —
--                                passing someone else's search_id simply
--                                yields zero rows, not another user's data.
--
-- Filtering: every cheap/DB-safe predicate (make/model slug incl. model
-- prefix match for body/trim suffixes, price/year/km/power ranges,
-- fuel/body/transmission/source/drive lists) runs here. fuel/body/transmission
-- stay null-lenient (a listing with an unknown value is not excluded), mirroring
-- packages/core's matchesSearch; drive is strict (null never matches a ticked
-- filter), same as matchesSearch.
--
-- Equipment/keyword text filtering ("Výbava"/"Verze" chips, keyword box) is
-- NOT exact here: p_text_terms is an OR'd ILIKE prefilter (every requested
-- synonym across every ticked feature, plus keywords) against
-- title/variant/equipment. The web app still runs the exact whole-token
-- check (core's hasAllFeatures/includesPhrase) over the returned page before
-- rendering, since SQL ILIKE can't express "whole token" cheaply. This means
-- a page can legitimately return fewer than p_limit true matches when text
-- filters are active -- see README.md "Known limitations" and the comment in
-- apps/web/app/results/page.tsx above the call site.
--
-- Dedup: one row per group_id (or per listing id when group_id is null),
-- keeping the cheapest (price_czk asc, nulls last) with the highest
-- group_offer_count exposed as its own column for the "více nabídek (N)" badge.
--
-- is_new: for the "all cars" scope, first_seen > p_seen_prev; for a search
-- scope, the match's matched_at > p_seen_prev (matches created_at doubles as
-- matched_at here -- see public.matches.matched_at).
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
  with base as (
    select
      l.*,
      m.id as match_id,
      m.status as match_status,
      m.matched_at as match_matched_at
    from public.listings l
    left join public.matches m
      on p_search_id is not null and m.listing_id = l.id and m.search_id = p_search_id
    where l.is_active
      and (p_search_id is null or (m.id is not null and m.status <> 'hidden'))
      and (p_make is null or l.make = p_make)
      and (p_model is null or l.model = p_model or l.model like (p_model || '-%'))
      and (p_price_from is null or l.price_czk >= p_price_from)
      and (p_price_to is null or l.price_czk <= p_price_to)
      and (p_year_from is null or l.year >= p_year_from)
      and (p_year_to is null or l.year <= p_year_to)
      and (p_mileage_max is null or l.mileage_km <= p_mileage_max)
      and (p_power_min_kw is null or l.power_kw >= p_power_min_kw)
      and (p_fuel is null or array_length(p_fuel, 1) is null or l.fuel is null or l.fuel = any (p_fuel))
      and (p_body is null or array_length(p_body, 1) is null or l.body is null or l.body = any (p_body))
      and (p_transmission is null or l.transmission is null or l.transmission = p_transmission)
      and (p_sources is null or array_length(p_sources, 1) is null or l.source = any (p_sources))
      and (p_drive is null or array_length(p_drive, 1) is null or (l.drive is not null and l.drive = any (p_drive)))
      and (
        p_text_terms is null or array_length(p_text_terms, 1) is null or exists (
          select 1 from unnest(p_text_terms) as t(term)
          where l.title ilike ('%' || t.term || '%')
            or l.variant ilike ('%' || t.term || '%')
            or exists (select 1 from unnest(l.equipment) as e(val) where e.val ilike ('%' || t.term || '%'))
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
  'Security-invoker paginated/deduped listing search backing /results. See README.md "Scope výsledků" and the extended comment above this function for the two scopes, the filter semantics and the text-prefilter limitation.';

-- ---------------------------------------------------------------------------
-- new_matches_count: cheap count of not-yet-seen matches across ALL of the
-- caller's enabled searches, for the "Výsledky" nav pill (task F).
-- ---------------------------------------------------------------------------
create or replace function public.new_matches_count()
returns bigint
language sql
security invoker
stable
as $$
  select count(*)::bigint
  from public.matches m
  join public.searches s on s.id = m.search_id
  left join public.user_state us on us.user_id = (select auth.uid())
  where s.user_id = (select auth.uid())
    and m.status <> 'hidden'
    and us.results_seen_prev is not null
    and m.matched_at > us.results_seen_prev;
$$;

revoke execute on function public.new_matches_count() from public, anon;
grant execute on function public.new_matches_count() to authenticated;

comment on function public.new_matches_count is
  'Count of matches created after the caller''s results_seen_prev watermark, across all of their searches. Backs the "Výsledky" nav count pill. Returns 0 (not an error) for a user who has never visited /results, since results_seen_prev is null until then.';
