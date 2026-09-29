"use server";

/**
 * Server actions for task C/D: "Uložit jako hledání" on /results, and
 * instant rematch on search create/update (both the /searches form and the
 * /results "save as search" flow land here).
 *
 * Everything below runs with the signed-in user's own Supabase session (the
 * normal anon-key + cookie session client, never service_role) — RLS on
 * `searches`/`matches` is what keeps a user from touching anyone else's rows,
 * the same as every other write in this app.
 */
import {
  matchesSearch,
  normalizeMake,
  normalizeModel,
  SearchQuerySchema,
  type BodyType,
  type Database,
  type DriveType,
  type FuelType,
  type Listing,
  type SearchQuery,
  type TransmissionType,
} from "@scrapping-auta/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { maybeAutoTriggerScrape } from "@/lib/scrape-trigger.server";

type Db = SupabaseClient<Database>;

export interface SaveSearchInput {
  id?: string;
  name: string;
  enabled: boolean;
  notify: boolean;
  make: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  price_from: number | null;
  price_to: number | null;
  mileage_max: number | null;
  fuel: FuelType[];
  transmission: TransmissionType | null;
  body: BodyType[];
  power_min_kw: number | null;
  keywords: string[];
  exclude_keywords: string[];
  sources: string[];
  drive: DriveType[];
  features: string[];
}

export interface SaveSearchResult {
  ok: boolean;
  error?: string;
  searchId?: string;
  matchCount?: number;
  scrapeTriggered?: boolean;
}

/** Row shape used to build a normalized `listings` row into a core `Listing`
 * for `matchesSearch` — mirrors packages/scrapers/src/runner.ts's own
 * candidate-matching loop so the web app's instant rematch and the nightly
 * scraper agree on what "matches" means. */
type ListingRow = Database["public"]["Tables"]["listings"]["Row"];

function rowToListing(row: ListingRow): Listing {
  // Defensively re-run `normalizeModel` on the stored value rather than
  // trusting `row.model` as-is: rows scraped before a model-alias fix lands
  // (e.g. the BMW "Řada 3"/"320d"/... -> "3-series" aliasing added alongside
  // this comment) keep their OLD, un-aliased slug in the DB until the
  // scraper next re-fetches that listing and upserts a fresh value. Since
  // `normalizeModel` is a pure function of (model, make), re-applying it
  // here costs nothing and means a stale row still rematches correctly in
  // the meantime — no migration needed to rewrite `listings.model` (see the
  // matching change to the candidate query below, which is the other half
  // of this: relying on this recompute instead of a possibly-stale SQL
  // filter on the raw column).
  const make = normalizeMake(row.make);
  return {
    source: row.source,
    sourceId: row.source_id,
    url: row.url,
    title: row.title,
    make,
    model: normalizeModel(row.model, make),
    variant: row.variant,
    year: row.year,
    mileageKm: row.mileage_km,
    priceCzk: row.price_czk,
    priceOrig: row.price_orig,
    currencyOrig: row.currency_orig,
    fuel: row.fuel as Listing["fuel"],
    transmission: row.transmission as Listing["transmission"],
    powerKw: row.power_kw,
    body: row.body as Listing["body"],
    color: row.color,
    location: row.location,
    country: row.country,
    sellerType: row.seller_type as Listing["sellerType"],
    vin: row.vin,
    imageUrls: row.image_urls ?? [],
    fingerprint: row.fingerprint,
    drive: row.drive as Listing["drive"],
    equipment: row.equipment ?? [],
  };
}

function toSearchQuery(row: {
  id: string;
  make: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  price_from: number | null;
  price_to: number | null;
  mileage_max: number | null;
  fuel: string[];
  transmission: string | null;
  body: string[];
  power_min_kw: number | null;
  keywords: string[];
  exclude_keywords: string[];
  sources: string[];
  drive: string[];
  features: string[];
}): SearchQuery {
  const make = normalizeMake(row.make);
  return SearchQuerySchema.parse({
    id: row.id,
    make,
    model: normalizeModel(row.model, make),
    yearFrom: row.year_from,
    yearTo: row.year_to,
    priceFrom: row.price_from,
    priceTo: row.price_to,
    mileageMax: row.mileage_max,
    fuel: row.fuel,
    transmission: row.transmission,
    body: row.body,
    powerMinKw: row.power_min_kw,
    keywords: row.keywords,
    excludeKeywords: row.exclude_keywords,
    sources: row.sources,
    drive: row.drive,
    features: row.features,
  });
}

const CANDIDATE_PAGE_SIZE = 1000;
/** Safety cap on how many candidate listings a single rematch will scan.
 * Above this, we still insert whatever new matches we found in the scanned
 * portion, but we SKIP stale-match deletion entirely (see the comment above
 * `staleDeletionSkipped` below) rather than risk deleting a still-valid
 * match that simply fell outside the scanned page. */
const CANDIDATE_SCAN_CAP = 20_000;

/** Pages through `queryBuilder` with `.range()` (ordered by `id` for stable
 * paging across pages) until exhausted or `cap` rows have been read.
 * PostgREST/Supabase caps a single response at ~1000 rows by default — the
 * previous implementation only ever fetched the first page, so a search
 * with no make/model filter and >1000 active listings would treat every
 * candidate past row 1000 as "not matching" and DELETE its (still valid)
 * match. */
async function fetchAllPages<T>(
  queryBuilder: { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> },
  cap: number
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await queryBuilder.range(offset, offset + CANDIDATE_PAGE_SIZE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < CANDIDATE_PAGE_SIZE) return { rows, truncated: false };
    offset += CANDIDATE_PAGE_SIZE;
    if (offset >= cap) return { rows, truncated: true };
  }
  return { rows, truncated: false };
}

/**
 * Rematches a single saved search against currently-active listings:
 *  1. DB-side prefilter (make/model/price/year — cheap, indexed) to keep the
 *     candidate set small instead of scanning every active listing, paged
 *     via `.range()` (ordered by `id`) so a search with a broad filter
 *     (e.g. no make/model) still sees every candidate rather than silently
 *     truncating at Supabase's default page size.
 *  2. Exact `matchesSearch` (packages/core) in code, same as the scraper.
 *  3. Upsert matches for newly-matching listings — these get `notified_at =
 *     now()` immediately, so the e-mail digest (which only sends matches
 *     where `notified_at is null`, see packages/scrapers/src/runner.ts)
 *     never re-sends something the user just saw appear instantly on
 *     /results. Only matches found by a *future* scraper run are left with
 *     `notified_at = null` and go out in the next digest.
 *  4. Delete matches that no longer satisfy the (possibly edited) query —
 *     except favourites (a user's favourite should survive an edited
 *     search rather than silently vanish) and except when the candidate
 *     scan hit `CANDIDATE_SCAN_CAP` (in that case we don't know whether an
 *     unmatched existing match is genuinely stale or just wasn't reached by
 *     the scan, so we skip deletion entirely rather than risk deleting a
 *     still-valid match).
 */
export async function rematchSearch(db: Db, searchId: string): Promise<number> {
  const { data: search, error: searchErr } = await db
    .from("searches")
    .select("*")
    .eq("id", searchId)
    .maybeSingle();
  if (searchErr || !search) return 0;

  const query = toSearchQuery(search);

  // Model filtering is deliberately NOT pushed into this SQL prefilter (only
  // make/price/year are, all cheap and always correct — make normalization
  // is stable). `listings.model` can still hold an old, un-aliased raw slug
  // for a row the scraper hasn't re-fetched since a model-alias fix landed
  // (e.g. a BMW row stored as "320d" before the "Řada 3"/"320d"/...
  // -> "3-series" aliasing was added) — an `.eq`/`.like` condition on that
  // raw column would silently exclude exactly the stale rows a rematch is
  // supposed to fix, without ever reaching `matchesSearch`. Instead, every
  // candidate for the make is fetched and `rowToListing` recomputes its
  // model via `normalizeModel` before `matchesSearch` compares it — the
  // matcher's own model-matching logic (exact/prefix/title-fallback) does
  // the real filtering, same as the scraper.
  let candidateQuery = db.from("listings").select("*").eq("is_active", true).order("id");
  if (query.make) candidateQuery = candidateQuery.eq("make", query.make);
  if (query.priceFrom != null) candidateQuery = candidateQuery.gte("price_czk", query.priceFrom);
  if (query.priceTo != null) candidateQuery = candidateQuery.lte("price_czk", query.priceTo);
  if (query.yearFrom != null) candidateQuery = candidateQuery.gte("year", query.yearFrom);
  if (query.yearTo != null) candidateQuery = candidateQuery.lte("year", query.yearTo);

  const { rows: candidates, truncated: candidatesTruncated } = await fetchAllPages(
    candidateQuery,
    CANDIDATE_SCAN_CAP
  );

  const matchingIds: string[] = [];
  for (const row of candidates) {
    const listing = rowToListing(row);
    if (matchesSearch(listing, query)) matchingIds.push(row.id);
  }
  const matchingIdSet = new Set(matchingIds);

  const { rows: existing } = await fetchAllPages(
    db.from("matches").select("id, listing_id, status").eq("search_id", searchId).order("id"),
    CANDIDATE_SCAN_CAP
  );
  const existingByListing = new Map(existing.map((m) => [m.listing_id, m.id]));

  const toInsert = matchingIds.filter((id) => !existingByListing.has(id));

  // Skip stale-match deletion entirely once the candidate scan was
  // truncated by CANDIDATE_SCAN_CAP: an existing match whose listing wasn't
  // in `matchingIds` might genuinely no longer match, or might simply be a
  // candidate the scan never reached — we can't tell the two apart, and
  // silently deleting a still-valid match is worse than leaving a stale one
  // around until the next full scraper run corrects it.
  const staleMatchIds = candidatesTruncated
    ? []
    : existing
        .filter((m) => m.status !== "favorite" && !matchingIdSet.has(m.listing_id))
        .map((m) => m.id);

  if (toInsert.length > 0) {
    const nowIso = new Date().toISOString();
    await db.from("matches").insert(
      toInsert.map((listingId) => ({
        search_id: searchId,
        listing_id: listingId,
        status: "new",
        matched_at: nowIso,
        // Instant rematch surfaces these immediately in the UI — mark them
        // already-notified so the nightly digest doesn't re-send them.
        notified_at: nowIso,
      }))
    );
  }
  if (staleMatchIds.length > 0) {
    await db.from("matches").delete().in("id", staleMatchIds);
  }

  return matchingIds.length;
}

/** Task C/D entry point: creates or updates a saved search, then rematches
 * it instantly and best-effort triggers a scrape run. */
export async function saveSearchAndRematch(input: SaveSearchInput): Promise<SaveSearchResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Aplikace není nakonfigurovaná." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nejste přihlášeni." };

  const payload = {
    user_id: user.id,
    name: input.name || "Bez názvu",
    enabled: input.enabled,
    notify: input.notify,
    make: normalizeMake(input.make),
    model: normalizeModel(input.model, input.make),
    year_from: input.year_from,
    year_to: input.year_to,
    price_from: input.price_from,
    price_to: input.price_to,
    mileage_max: input.mileage_max,
    fuel: input.fuel,
    transmission: input.transmission,
    body: input.body,
    power_min_kw: input.power_min_kw,
    keywords: input.keywords,
    exclude_keywords: input.exclude_keywords,
    sources: input.sources,
    drive: input.drive,
    features: input.features,
  };

  let searchId = input.id;
  if (searchId) {
    const { error } = await supabase.from("searches").update(payload).eq("id", searchId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase.from("searches").insert(payload).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Uložení se nezdařilo." };
    searchId = data.id;
  }

  const matchCount = await rematchSearch(supabase, searchId!);
  const { triggered } = await maybeAutoTriggerScrape();

  return { ok: true, searchId, matchCount, scrapeTriggered: triggered };
}
