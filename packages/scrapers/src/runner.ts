import {
  detectFeatures,
  isFeatureOnlyMismatch,
  matchesSearch,
  normalizeListing,
  normalizeMake,
  normalizeModel,
  SearchQuerySchema,
  type Listing,
  type SearchQuery,
} from "@scrapping-auta/core";
import type { SourceAdapter } from "./adapter.js";
import { getAdapter } from "./registry.js";
import { fetchEurCzkRate } from "./exchange-rate.js";
import {
  sendMatchDigestEmail,
  loadEmailSenderConfig,
  type NotifySearchGroup,
  type NotifyFavoriteChange,
} from "./notify/email.js";
import { fetchForGoneCheck, MAX_RESULT_PAGES } from "./http.js";
import { selectListingsToStore } from "./selection.js";
import { isGone } from "./gone-detection.js";
import { checkListingsHaveLoadableImages, IMAGE_CHECK_CONCURRENCY } from "./image-check.js";
import { createSupabaseClient, type DbClient } from "./db.js";
import { getVapidConfig, sendPushToUser, type VapidConfig } from "./push.js";
import { checkSourceHealthAndAlert } from "./health-alert.js";
import { checkFavoritesAlerts, sendFavoritesAlertPush } from "./favorites-alert.js";

export type { DbClient } from "./db.js";
export { createSupabaseClient } from "./db.js";

const CLEANUP_UNMATCHED_AFTER_DAYS = 3;
const CLEANUP_BATCH_SIZE = 200;
/** Per source, per run — keeps a run from spending its whole time budget
 * re-checking a huge backlog of possibly-gone listings. Any candidate not
 * checked this run is simply picked up again next run. */
const MAX_GONE_CHECKS_PER_SOURCE = 50;
/** A favourited listing confirmed gone from its source is kept (not
 * deleted) for this long after `gone_at`, so the user gets to see "Prodáno /
 * nedostupné od <datum>" on the Oblíbené page before it's swept away. A
 * product default — see README.md "Smazané inzeráty" for how to change it. */
const GONE_FAVORITE_RETENTION_DAYS = 7;
/** Circuit breaker for checkGoneListings(): a source's gone-check is only
 * trusted to delete anything once at least this many candidates were
 * actually checked this run (below that, a ratio is too noisy to act on). */
const GONE_CIRCUIT_BREAKER_MIN_CHECKED = 5;
/** ...and only trusted if the confirmed-gone share stays at or below this
 * ratio of checked candidates... */
const GONE_CIRCUIT_BREAKER_RATIO = 0.3;
/** ...or, regardless of ratio, caps the absolute count in one run — a
 * source with a huge backlog could clear the ratio bar by having a huge
 * denominator while still deleting an alarming number of listings. */
const GONE_CIRCUIT_BREAKER_MAX_ABSOLUTE = 20;
/** Detail-page enrichment for near-match listings (see `enrichNearMatches`
 * below): at most this many detail-page fetches per source per run, so a
 * source with a lot of near-misses can't dominate the run's time/politeness
 * budget — any candidate not reached this run is simply picked up again next
 * run (or the run after, once its listing next re-qualifies as a
 * near-match). */
export const MAX_DETAIL_FETCHES_PER_SOURCE_PER_RUN = 40;
/** A `detail_text_cache` row older than this is treated as stale and
 * re-fetched rather than reused — a listing's equipment/description text can
 * change (price drops, re-listings, edited ads). */
export const DETAIL_CACHE_MAX_AGE_DAYS = 14;
/**
 * Per-source override for how many result pages a run walks, above the
 * shared `MAX_RESULT_PAGES` safety cap (30) — see the 2026-10 pagination-
 * coverage audit (packages/scrapers/scripts/pagination-measure.ts, not
 * committed — its output is summarized here and in the task's report). Kept
 * to the two sources with live-confirmed evidence the shared default still
 * truncates a REAL saved search (not just an unfiltered probe):
 *   - autoscout24: VW Multivan 2022+/automatic/"prodloužená" (saved search
 *     #2's own filters, via `pnpm audit:sources -- --query=vw-multivan`)
 *     still hit exactly 600 (30 pages * 20/page) — confirmed truncated, not
 *     a coincidence (its own PAGE_SIZE multiple). Matches this adapter's
 *     long-standing doc comment (100-800+ results confirmed live for a
 *     narrowed query on its Germany-only `cy=D` inventory).
 *   - carvago: BMW 3-series (saved search #1's own full filters — price,
 *     diesel, automatic, awd, powerMinKw 130 — via `pnpm audit:sources --
 *     --query=bmw-3-series-full`) ALSO hit exactly 600, despite carvago
 *     filtering most of those fields server-side (confirmed in its own doc
 *     comment) — whatever the reason, confirmed truncated on a real, fully-
 *     filtered saved search, not just a bare probe. 60 pages (1200) gives
 *     it extra headroom over autoscout24's 50 given this was its REAL
 *     filtered query, not just an unfiltered one.
 * Every OTHER source's real (fully-filtered) saved-search numbers measured
 * comfortably under the shared 30-page cap (e.g. autoscout24's OWN
 * bmw-3-series-full query — 312 fetched, not capped — and sauto's — 37
 * fetched; see the report) — including tipcars, which no longer gets a
 * special case (it did when the shared default was only 5; its real
 * catalogs for these searches, ~220-450, fit well inside the new default).
 */
const PER_SOURCE_MAX_PAGES: Partial<Record<string, number>> = {
  autoscout24: 50,
  carvago: 60,
};

/** Resolves how many result pages a run walks for one source+query pair.
 * Exported for unit testing. */
export function resolveMaxPages(sourceId: string, _query: SearchQuery): number {
  return PER_SOURCE_MAX_PAGES[sourceId] ?? MAX_RESULT_PAGES;
}
/** Per source, per run — caps how many listings get a real "does the image
 * load?" network check (see `filterListingsWithLoadableImages` below). A
 * listing past this cap isn't confirmed either way this run, so — same
 * fail-open philosophy as the gone-check's circuit breaker — it's kept
 * rather than dropped; it'll be checked (as "new", since it's still not in
 * the DB yet) again next run. */
export const MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN = 150;

export interface RunOptions {
  dryRun?: boolean;
  sourceFilter?: string;
  /**
   * Scopes the whole run to one user's enabled searches (CLI: `--user=
   * <uuid>`; set by the "Spustit scraping mých hledání" button via
   * workflow_dispatch's `user_id` input — see apps/web/app/api/scrape/
   * route.ts, which always derives this from the signed-in user's own
   * session, never a client-supplied value).
   *
   * A user-scoped run:
   *   - only loads/matches this user's own enabled `searches` rows (so only
   *     sources those searches actually reference get fetched at all — the
   *     existing per-source `relevantSearches` skip below already does this
   *     once `searches` itself is filtered);
   *   - only e-mails/pushes this user (see `notifyNewMatches`'s
   *     `userFilter` param);
   *   - SKIPS every maintenance step that needs a full, all-users picture
   *     to be trustworthy: `checkGoneListings`, `cleanupUnmatchedListings`,
   *     `deleteExpiredGoneFavorites`, and `checkSourceHealthAndAlert` — a
   *     partial run touching only this user's searches/sources can't tell
   *     "genuinely gone/unmatched" from "just not relevant to this run";
   *   - still inserts a `scrape_runs` row per source touched (tagged with
   *     `user_id`), but does NOT update `sources.last_run_at/last_ok_at/
   *     last_count` — those columns back the "Stav zdrojů" page and the
   *     health watchdog, both of which expect every source's number to
   *     reflect a full run, not one user's slice of searches.
   */
  userFilter?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  /** Test a specific saved-search shape in dry-run instead of the default
   * "everything" query (CLI: `--query='{"make":"ford","...":...}'`). Fields
   * are normalized/defaulted the same way a real saved search would be. */
  queryOverride?: Partial<SearchQuery>;
}

interface SearchRow {
  id: string;
  user_id: string;
  name: string;
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
  notify: boolean;
}

function toSearchQuery(row: SearchRow): SearchQuery {
  const make = normalizeMake(row.make);
  return {
    id: row.id,
    // Saved searches can carry raw, un-normalized user input (e.g. a
    // trailing space, diacritics, or a display name instead of a slug) —
    // normalize here so every adapter and the matcher get a clean slug.
    make,
    model: normalizeModel(row.model, make),
    yearFrom: row.year_from,
    yearTo: row.year_to,
    priceFrom: row.price_from,
    priceTo: row.price_to,
    mileageMax: row.mileage_max,
    fuel: (row.fuel ?? []) as SearchQuery["fuel"],
    transmission: row.transmission as SearchQuery["transmission"],
    body: (row.body ?? []) as SearchQuery["body"],
    powerMinKw: row.power_min_kw,
    keywords: row.keywords ?? [],
    excludeKeywords: row.exclude_keywords ?? [],
    sources: row.sources ?? [],
    drive: (row.drive ?? []) as SearchQuery["drive"],
    features: row.features ?? [],
  };
}

/** Builds a fully-defaulted SearchQuery from a partial CLI/test override,
 * normalizing make/model the same way a real saved search would be. */
function toOverrideQuery(override: Partial<SearchQuery>): SearchQuery {
  const parsed = SearchQuerySchema.parse(override);
  const make = normalizeMake(parsed.make);
  return {
    ...parsed,
    make,
    model: normalizeModel(parsed.model, make),
  };
}

/**
 * Detail-page enrichment for "near-match" listings: a listing that fails
 * EVERY relevant query only on "features" (see core's `isFeatureOnlyMismatch`
 * — it would be a full match if the feature/version chip(s) were satisfied)
 * often has the missing info (e.g. "prodloužená verze"/long wheelbase) only
 * on its DETAIL page, not the list page the adapter's `search()` already
 * scraped. For each such listing (capped at `MAX_DETAIL_FETCHES_PER_SOURCE_
 * PER_RUN`), this:
 *   1. checks `detail_text_cache` first (skipped entirely in dry-run/no-db —
 *      there's nowhere to read or write it, so it just fetches, still capped
 *      the same way);
 *   2. on a cache miss (or a stale one, older than `DETAIL_CACHE_MAX_AGE_
 *      DAYS`), calls the adapter's optional `fetchDetailText` and re-runs
 *      `detectFeatures` over title+variant+equipment+detail text;
 *   3. writes the result back to `detail_text_cache` (even an empty
 *      detection — that's a meaningful "fetched, found nothing", distinct
 *      from "never looked");
 *   4. sets `listing.detailFeatures` in place, so every subsequent use of
 *      this same `Listing` object (matching, selection, upsert) sees it.
 *
 * A no-op when the adapter has no `fetchDetailText` (most sources) or there
 * are no relevant queries at all.
 */
export async function enrichNearMatches(
  db: DbClient | null,
  sourceId: string,
  adapter: SourceAdapter,
  listings: Listing[],
  queries: SearchQuery[]
): Promise<void> {
  if (!adapter.fetchDetailText || queries.length === 0) return;

  const candidates = listings.filter((listing) => queries.some((q) => isFeatureOnlyMismatch(listing, q)));
  if (candidates.length === 0) return;

  const limited = candidates.slice(0, MAX_DETAIL_FETCHES_PER_SOURCE_PER_RUN);
  const cacheCutoff = new Date(
    Date.now() - DETAIL_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const freshCacheBySourceId = new Map<string, string[]>();
  if (db) {
    const { data, error } = await db
      .from("detail_text_cache")
      .select("source_id, features, fetched_at")
      .eq("source", sourceId)
      .in(
        "source_id",
        limited.map((l) => l.sourceId)
      );
    if (error) {
      console.warn(`[runner] ${sourceId}: detail-cache lookup failed:`, error.message);
    } else {
      for (const row of data ?? []) {
        if (row.fetched_at >= cacheCutoff) freshCacheBySourceId.set(row.source_id, row.features ?? []);
      }
    }
  }

  let fetchedCount = 0;
  let cacheHitCount = 0;
  for (const listing of limited) {
    const cached = freshCacheBySourceId.get(listing.sourceId);
    if (cached) {
      listing.detailFeatures = cached;
      cacheHitCount++;
      continue;
    }

    let detailText: string | null = null;
    try {
      detailText = await adapter.fetchDetailText({ url: listing.url, sourceId: listing.sourceId });
    } catch (err) {
      console.warn(
        `[runner] ${sourceId}: fetchDetailText threw for ${listing.sourceId} (treating as no detail text):`,
        (err as Error).message
      );
    }
    fetchedCount++;

    const haystack = `${listing.title} ${listing.variant ?? ""} ${(listing.equipment ?? []).join(" ")} ${detailText ?? ""}`;
    const detected = detectFeatures(haystack);
    listing.detailFeatures = detected;

    if (db) {
      const { error } = await db.from("detail_text_cache").upsert(
        {
          source: sourceId,
          source_id: listing.sourceId,
          features: detected,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "source,source_id" }
      );
      if (error) {
        console.warn(
          `[runner] ${sourceId}: failed to cache detail features for ${listing.sourceId}:`,
          error.message
        );
      }
    }
  }

  console.log(
    `[runner] ${sourceId}: detail-enrichment — ${candidates.length} near-match candidate(s), ` +
      `${cacheHitCount} from cache, ${fetchedCount} fetched (cap ${MAX_DETAIL_FETCHES_PER_SOURCE_PER_RUN})`
  );
}

function sameImageUrls(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

/**
 * Product decision (see README "Co se ukládá do databáze"): a listing
 * without even one loadable photo isn't stored at all — see
 * image-check.ts for the actual "does this URL load" network check.
 *
 *   1. No `imageUrls` at all -> always dropped, no network call needed.
 *   2. Already in the DB, with the exact same `imageUrls` as last run ->
 *      never re-checked (its image already passed, or was never checked
 *      before this feature existed — either way, re-checking a huge
 *      existing backlog every run would be wasteful and isn't the point;
 *      the point is to stop a *new* broken-image listing from ever landing
 *      in the first place).
 *   3. New (not yet in the DB) or existing-but-`imageUrls`-changed ->
 *      checked for real, capped at `MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN`
 *      and run with `IMAGE_CHECK_CONCURRENCY` at a time. A listing that
 *      doesn't make the cap this run is kept (fail-open, same as the
 *      gone-check's circuit breaker) — it's still "new" next run, so it'll
 *      get its turn.
 *
 * Runs in dry-run (no `db`) too, so it's testable with `--query` — every
 * listing is then treated as "new" (there's no persisted state to diff
 * against), still capped the same way.
 */
export async function filterListingsWithLoadableImages(
  db: DbClient | null,
  sourceId: string,
  listings: Listing[]
): Promise<Listing[]> {
  const withImages = listings.filter((l) => l.imageUrls.length > 0);
  const droppedNoImage = listings.length - withImages.length;

  const existingImageUrlsBySourceId = new Map<string, string[]>();
  if (db && withImages.length > 0) {
    const { data, error } = await db
      .from("listings")
      .select("source_id, image_urls")
      .eq("source", sourceId)
      .in(
        "source_id",
        withImages.map((l) => l.sourceId)
      );
    if (error) {
      console.warn(`[runner] ${sourceId}: image-check existing-lookup failed:`, error.message);
    } else {
      for (const row of data ?? []) {
        existingImageUrlsBySourceId.set(row.source_id, row.image_urls ?? []);
      }
    }
  }

  const needsCheck: Listing[] = [];
  const skipsCheck: Listing[] = [];
  for (const listing of withImages) {
    const existingUrls = existingImageUrlsBySourceId.get(listing.sourceId);
    const isNew = db != null && existingUrls === undefined;
    const changed = existingUrls !== undefined && !sameImageUrls(existingUrls, listing.imageUrls);
    if (!db || isNew || changed) {
      needsCheck.push(listing);
    } else {
      skipsCheck.push(listing);
    }
  }

  const toCheck = needsCheck.slice(0, MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN);
  const uncheckedOverCap = needsCheck.slice(MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN);

  const results =
    toCheck.length > 0
      ? await checkListingsHaveLoadableImages(
          toCheck.map((l) => l.imageUrls),
          IMAGE_CHECK_CONCURRENCY
        )
      : [];
  const checkedOk = toCheck.filter((_, i) => results[i]);
  const droppedBrokenImage = toCheck.length - checkedOk.length;

  console.log(
    `[runner] ${sourceId}: image-check — ${droppedNoImage} dropped (no image URL), ` +
      `${skipsCheck.length} unchanged (skipped check), ${toCheck.length} checked ` +
      `(cap ${MAX_IMAGE_CHECKS_PER_SOURCE_PER_RUN}), ${droppedBrokenImage} dropped (image doesn't load), ` +
      `${uncheckedOverCap.length} over cap (kept, unchecked)`
  );

  return [...skipsCheck, ...checkedOk, ...uncheckedOverCap];
}

export async function runScrape(opts: RunOptions = {}): Promise<void> {
  const dryRun = Boolean(opts.dryRun);
  const supabaseUrl = opts.supabaseUrl ?? process.env.SUPABASE_URL;
  const serviceKey = opts.supabaseServiceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!dryRun && (!supabaseUrl || !serviceKey)) {
    console.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, exiting without error.");
    return;
  }

  const db: DbClient | null = dryRun ? null : createSupabaseClient(supabaseUrl!, serviceKey!);
  // Read once per run and reused for every push send below — see push.ts's
  // doc comment for why this lives in app_secrets rather than an env var.
  const vapid = db ? await getVapidConfig(db) : null;

  const eurCzkRate = await fetchEurCzkRate({
    fetchLastKnownRate: db
      ? async () => {
          const { data } = await db
            .from("exchange_rates")
            .select("eur_czk")
            .order("rate_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          return data?.eur_czk ?? null;
        }
      : undefined,
  });
  console.log(`[runner] EUR/CZK rate: ${eurCzkRate}`);

  if (db) {
    const today = new Date().toISOString().slice(0, 10);
    await db.from("exchange_rates").upsert({ rate_date: today, eur_czk: eurCzkRate });
  }

  let sourceIds: string[];
  const sourceMetaById = new Map<string, { name: string; lastAlertAt: string | null }>();
  if (db) {
    const { data: sourceRows, error } = await db
      .from("sources")
      .select("id, enabled, name, last_alert_at")
      .eq("enabled", true);
    if (error) throw error;
    sourceIds = (sourceRows ?? []).map((s) => s.id);
    for (const s of sourceRows ?? []) {
      sourceMetaById.set(s.id, { name: s.name, lastAlertAt: s.last_alert_at });
    }
  } else {
    sourceIds = Object.keys((await import("./registry.js")).ADAPTERS);
  }
  if (opts.sourceFilter) {
    sourceIds = sourceIds.filter((id) => id === opts.sourceFilter);
  }

  let searches: SearchRow[] = [];
  if (db) {
    let searchesQuery = db.from("searches").select("*").eq("enabled", true);
    if (opts.userFilter) searchesQuery = searchesQuery.eq("user_id", opts.userFilter);
    const { data, error } = await searchesQuery;
    if (error) throw error;
    searches = (data ?? []) as unknown as SearchRow[];
  }

  if (db && opts.userFilter && searches.length === 0) {
    // Nothing to do — no scrape_runs noise, no per-source fetches, for a
    // user with no enabled searches at all.
    console.log(`[runner] user-scoped run for ${opts.userFilter}: no enabled searches, nothing to do`);
    return;
  }

  const allNewMatches: { searchId: string; listingId: string }[] = [];

  for (const sourceId of sourceIds) {
    const adapter = getAdapter(sourceId);
    if (!adapter) {
      console.warn(`[runner] no adapter registered for source "${sourceId}", skipping`);
      continue;
    }
    const relevantSearches = db
      ? searches.filter((s) => s.sources.length === 0 || s.sources.includes(sourceId))
      : [];
    if (db && relevantSearches.length === 0 && searches.length > 0) {
      console.log(`[runner] no enabled searches use "${sourceId}", skipping`);
      continue;
    }

    const startedAt = new Date().toISOString();
    let found = 0;
    let newCount = 0;
    let errorText: string | null = null;
    let goneWarning: string | null = null;
    let searchWarning: string | null = null;
    let pageCapWarning: string | null = null;

    try {
      const overrideQuery = opts.queryOverride ? toOverrideQuery(opts.queryOverride) : null;
      if (overrideQuery && overrideQuery.sources.length > 0 && !overrideQuery.sources.includes(sourceId)) {
        console.log(`[runner] --query sources filter excludes "${sourceId}", skipping`);
        continue;
      }
      const queries: SearchQuery[] = db
        ? relevantSearches.map(toSearchQuery)
        : [
            overrideQuery ?? {
              make: null,
              model: null,
              fuel: [],
              body: [],
              keywords: [],
              excludeKeywords: [],
              sources: [],
              drive: [],
              features: [],
            },
          ];
      // Index-aligned with `queries` — just for labeling `pageCapHits`
      // messages below with something a human recognizes (a saved search's
      // name), not used for matching/fetching itself.
      const queryLabels: string[] = db ? relevantSearches.map((s) => s.name) : [overrideQuery ? "--query" : "(all)"];

      const rawById = new Map<string, Awaited<ReturnType<typeof adapter.search>>[number]>();
      // A query that throws is logged and skipped so one broken saved
      // search can't block every OTHER search using this source — but the
      // failure itself must still surface somewhere. Silently swallowing it
      // here is exactly how a source can go to `found: 0` with an empty
      // `scrape_runs.errors` and nobody notices (see aaaauto.ts's history) —
      // so every failure is also collected into `searchWarning` below,
      // which rides along on the same `errors` column as `goneWarning`.
      const queryFailures: string[] = [];
      // Pagination safety-cap hits (see SourceContext.onPageCapHit): a
      // source/query that hit its page cap while more results likely remain
      // — collected the same way as queryFailures, surfaced below.
      const pageCapHits: { label: string; cap: number }[] = [];
      for (let i = 0; i < queries.length; i++) {
        const query = queries[i]!;
        const maxPages = resolveMaxPages(sourceId, query);
        try {
          const results = await adapter.search(query, {
            eurCzkRate,
            maxPages,
            onPageCapHit: () => pageCapHits.push({ label: queryLabels[i] ?? "?", cap: maxPages }),
          });
          for (const r of results) rawById.set(r.sourceId, r);
        } catch (err) {
          const message = (err as Error).message;
          console.warn(`[runner] ${sourceId} search failed for one query:`, message);
          queryFailures.push(message);
        }
      }
      found = rawById.size;
      if (queryFailures.length > 0) {
        const extra = queryFailures.length > 1 ? ` (+${queryFailures.length - 1} more)` : "";
        searchWarning =
          `[search] ${sourceId}: ${queryFailures.length}/${queries.length} ` +
          `${queries.length === 1 ? "query" : "queries"} failed: ${queryFailures[0]}${extra}`;
      }
      if (pageCapHits.length > 0) {
        // Rides along on `scrape_runs.errors` for visibility (same mechanism
        // as `goneWarning`) but — like `goneWarning`, and UNLIKE
        // `searchWarning` — deliberately kept OUT of the "errored" signal
        // passed to the health-alert watchdog below: the source DID return
        // cars this run, there's just more of them than the safety cap
        // reached, which isn't "stopped returning cars" broken.
        pageCapWarning = pageCapHits
          .map((h) => `[pages] ${sourceId}: hit page cap ${h.cap} for search ${h.label}`)
          .join("; ");
      }

      const normalized: Listing[] = Array.from(rawById.values()).map((raw) =>
        normalizeListing(raw, { source: sourceId, eurCzkRate })
      );

      // Only listings matching at least one enabled saved search that uses
      // this source get persisted (product decision: the DB holds matches
      // only, not everything the scraper fetches — see README). `--query`
      // lets you dry-run against a hypothetical saved search instead of the
      // ones actually stored in the DB.
      const searchQueriesForSource: SearchQuery[] = overrideQuery
        ? [overrideQuery]
        : db
          ? relevantSearches.map(toSearchQuery)
          : [];

      // Detail-page enrichment: for listings that fail every relevant query
      // ONLY on "features" (see isFeatureOnlyMismatch), fetch the listing's
      // detail page and re-detect features from title+variant+equipment+
      // detail text — mutates `normalized` entries in place (sets
      // `detailFeatures`), so every use of `normalized`/`toStore` below
      // (selection, matching, upsert) automatically benefits.
      await enrichNearMatches(db, sourceId, adapter, normalized, searchQueriesForSource);

      const matchedSearch = selectListingsToStore(normalized, searchQueriesForSource);
      // Product decision: a listing with no loadable image never gets
      // stored/matched/notified at all (see README) — see
      // filterListingsWithLoadableImages's doc comment. Runs in dry-run too
      // (with no `db`, every listing is treated as "new") so `--query` stays
      // a faithful preview of what a real run would do.
      const toStore = await filterListingsWithLoadableImages(db, sourceId, matchedSearch);

      if (dryRun || !db) {
        console.log(
          `[runner] [dry-run] ${sourceId}: fetched ${normalized.length}, ${matchedSearch.length} match a saved search, ` +
            `${toStore.length} have a loadable image (would be stored)`
        );
        for (const listing of toStore.slice(0, 5)) {
          console.log(
            `  [match] ${listing.title} | ${listing.priceCzk ?? "?"} Kč | ${listing.year ?? "?"} | ${listing.mileageKm ?? "?"} km`
          );
        }
        continue;
      }

      for (const listing of toStore) {
        const { data: existing } = await db
          .from("listings")
          .select("id, price_czk, group_id")
          .eq("source", sourceId)
          .eq("source_id", listing.sourceId)
          .maybeSingle();

        let groupId = existing?.group_id ?? null;
        if (!groupId) {
          const { data: fpMatch } = await db
            .from("listings")
            .select("group_id")
            .eq("fingerprint", listing.fingerprint)
            .not("group_id", "is", null)
            .limit(1)
            .maybeSingle();
          groupId = fpMatch?.group_id ?? crypto.randomUUID();
        }

        const now = new Date().toISOString();
        const { data: upserted, error: upsertError } = await db
          .from("listings")
          .upsert(
            {
              source: sourceId,
              source_id: listing.sourceId,
              url: listing.url,
              title: listing.title,
              make: listing.make,
              model: listing.model,
              variant: listing.variant,
              year: listing.year,
              mileage_km: listing.mileageKm,
              price_czk: listing.priceCzk,
              price_orig: listing.priceOrig,
              currency_orig: listing.currencyOrig,
              fuel: listing.fuel,
              transmission: listing.transmission,
              power_kw: listing.powerKw,
              body: listing.body,
              color: listing.color,
              location: listing.location,
              country: listing.country,
              seller_type: listing.sellerType,
              vin: listing.vin,
              image_urls: listing.imageUrls,
              drive: listing.drive,
              equipment: listing.equipment,
              detail_features: listing.detailFeatures,
              last_seen: now,
              is_active: true,
              fingerprint: listing.fingerprint,
              group_id: groupId,
            },
            { onConflict: "source,source_id" }
          )
          .select("id, price_czk")
          .single();

        if (upsertError || !upserted) {
          console.warn(`[runner] upsert failed for ${sourceId}/${listing.sourceId}:`, upsertError?.message);
          continue;
        }
        if (!existing) newCount++;
        if (!existing || existing.price_czk !== upserted.price_czk) {
          await db
            .from("price_history")
            .insert({ listing_id: upserted.id, price_czk: upserted.price_czk });
        }

        for (const search of relevantSearches) {
          const query = toSearchQuery(search);
          if (!matchesSearch(listing, query)) continue;
          const { data: newMatch } = await db
            .from("matches")
            .upsert(
              { search_id: search.id, listing_id: upserted.id },
              { onConflict: "search_id,listing_id", ignoreDuplicates: true }
            )
            .select("id")
            .maybeSingle();
          if (newMatch) allNewMatches.push({ searchId: search.id, listingId: upserted.id });
        }
      }

      // Gone-listing checks need the full picture (every search across
      // every user) to safely tell "genuinely gone" from "not fetched by
      // this run's narrower user-scoped query set" — skipped entirely for a
      // user-scoped run (see RunOptions.userFilter's doc comment).
      if (!opts.userFilter) {
        goneWarning = await checkGoneListings(db, sourceId, new Set(rawById.keys()));
      }
    } catch (err) {
      errorText = (err as Error).message;
      console.error(`[runner] ${sourceId} failed:`, errorText);
    }

    if (db) {
      const finishedAt = new Date().toISOString();
      // A tripped gone-check circuit breaker doesn't stop the scrape itself
      // from having succeeded (the source was fetched fine, listings were
      // upserted normally) — but it's still worth surfacing loudly, so it
      // rides along on the same `errors` column the "Stav zdrojů" page
      // already reads, and likewise withholds `last_ok_at` for this run.
      const runErrors =
        [errorText, searchWarning, goneWarning, pageCapWarning].filter((m): m is string => Boolean(m)).join("; ") ||
        null;
      await db.from("scrape_runs").insert({
        source: sourceId,
        started_at: startedAt,
        finished_at: finishedAt,
        found,
        new: newCount,
        errors: runErrors,
        // Tags this row as belonging to a user-scoped manual run (null for
        // every regular/cron run) — see RunOptions.userFilter's doc comment
        // and the health watchdog / "Stav zdrojů" page, both of which
        // filter these out of their history.
        user_id: opts.userFilter ?? null,
      });

      // A user-scoped run only ever sees a slice of this source's relevant
      // searches, so `found`/health here reflect that slice, not the
      // source's real overall health — never let it overwrite
      // sources.last_run_at/last_ok_at/last_count, and never feed it to the
      // health watchdog (see RunOptions.userFilter's doc comment).
      if (!opts.userFilter) {
        await db
          .from("sources")
          .update({
            last_run_at: finishedAt,
            ...(runErrors ? {} : { last_ok_at: finishedAt }),
            last_count: found,
          })
          .eq("id", sourceId);

        // Source health alert (see health-alert.ts): the scrape itself
        // failing/returning nothing (errorText) or every relevant query
        // throwing (searchWarning, e.g. aaaauto's bot-block detection) counts
        // as "errored" here — but NOT a tripped gone-check circuit breaker
        // (goneWarning), which is a different, already-surfaced issue, and the
        // source DID return cars this run in that case, so it shouldn't
        // trigger a "stopped returning cars" alert.
        const meta = sourceMetaById.get(sourceId);
        if (meta) {
          await checkSourceHealthAndAlert(
            db,
            vapid,
            { id: sourceId, name: meta.name, lastAlertAt: meta.lastAlertAt },
            found,
            Boolean(errorText || searchWarning)
          );
        }
      }
    }
  }

  if (db && !dryRun) {
    // Only a full run (all sources, all users) gets to decide a listing is
    // genuinely unmatched — a `--source` run only ever sees a slice of the
    // enabled searches' sources, and a `--user` run only ever sees one
    // user's searches, so neither can tell "not matched by this run's
    // narrower search set" from "not matched by any search at all".
    if (!opts.sourceFilter && !opts.userFilter) {
      await cleanupUnmatchedListings(db);
    }

    // Needs the full picture across every user's favourites to be safe —
    // skipped for a user-scoped run (see RunOptions.userFilter's doc
    // comment).
    if (!opts.userFilter) {
      await deleteExpiredGoneFavorites(db);
    }

    await notifyNewMatches(db, vapid, opts.userFilter);
  }
}

/**
 * "Is this listing actually gone from its source?" check (see
 * gone-detection.ts) for one source's run: any of that source's currently
 * active, not-already-`gone_at` listings that weren't in this run's fetched
 * results (`fetchedSourceIds`, keyed by the adapter's own `sourceId`) are
 * candidates. Each candidate's detail URL is fetched (politely throttled,
 * same as any other request to that host) to confirm before acting:
 *   - confirmed gone + NOT favorited -> delete (matches/price_history
 *     cascade, see cleanupUnmatchedListings' doc comment)
 *   - confirmed gone + favorited     -> is_active=false, gone_at=now();
 *     deleteExpiredGoneFavorites() sweeps these up after the retention
 *     window (see GONE_FAVORITE_RETENTION_DAYS)
 *   - not confirmed (network error, or still looks alive) -> left alone,
 *     re-checked next run
 * Capped at MAX_GONE_CHECKS_PER_SOURCE per source per run so a source with a
 * huge backlog of stale listings can't dominate the run's time budget —
 * anything past the cap is simply picked up again next run.
 *
 * SAFETY: GitHub Actions runners run from US/EU cloud IPs. If a source (or
 * something in front of it — Seznam's consent wall, a captcha, a geo-block
 * page) starts redirecting/blocking those IPs broadly, a naive "confirmed
 * gone" check could read that as the whole catalog having disappeared and
 * mass-delete it. Two independent guards against that:
 *   1. `isGone()` itself never confirms gone on a cross-site redirect (see
 *      gone-detection.ts) — a consent/captcha/geo page on another host is
 *      always "unknown", not "gone".
 *   2. A circuit breaker here: if an unusually large share of this run's
 *      checked candidates come back confirmed-gone, that's itself
 *      suspicious (a real source doesn't usually lose a third of its
 *      listings between two runs) — nothing gets deleted/deactivated for
 *      this source this run, and it's logged loudly and returned so the
 *      caller can record it on `scrape_runs.errors`.
 *
 * Returns a warning message when the circuit breaker tripped, else null.
 */
export async function checkGoneListings(
  db: DbClient,
  sourceId: string,
  fetchedSourceIds: Set<string>
): Promise<string | null> {
  const { data, error } = await db
    .from("listings")
    .select("id, source_id, url")
    .eq("source", sourceId)
    .eq("is_active", true)
    .is("gone_at", null);
  if (error) {
    console.warn(`[runner] gone-check: failed to load ${sourceId} listings:`, error.message);
    return null;
  }

  const candidates = (data ?? [])
    .filter((row) => !fetchedSourceIds.has(row.source_id))
    .slice(0, MAX_GONE_CHECKS_PER_SOURCE);

  let checked = 0;
  const goneCandidates: (typeof candidates)[number][] = [];

  for (const candidate of candidates) {
    checked++;
    let confirmed: boolean;
    try {
      const response = await fetchForGoneCheck(candidate.url);
      confirmed = isGone(sourceId, { ...response, originalUrl: candidate.url });
    } catch (err) {
      // Network-level failure (timeout, DNS, ...) — not confirmed, keep it
      // and retry next run.
      console.warn(
        `[runner] gone-check: request failed for ${sourceId}/${candidate.id}, keeping:`,
        (err as Error).message
      );
      continue;
    }
    if (confirmed) goneCandidates.push(candidate);
  }

  const goneCount = goneCandidates.length;
  const ratio = checked > 0 ? goneCount / checked : 0;
  const suspicious = checked >= GONE_CIRCUIT_BREAKER_MIN_CHECKED &&
    (ratio > GONE_CIRCUIT_BREAKER_RATIO || goneCount >= GONE_CIRCUIT_BREAKER_MAX_ABSOLUTE);

  if (suspicious) {
    const warning = `[gone] ${sourceId}: suspicious gone ratio ${goneCount}/${checked}, skipping deletions`;
    console.warn(warning);
    return warning;
  }

  let deleted = 0;
  let keptFavorite = 0;
  for (const candidate of goneCandidates) {
    const { data: favoriteRows } = await db
      .from("favorites")
      .select("user_id")
      .eq("listing_id", candidate.id)
      .limit(1);

    if (favoriteRows && favoriteRows.length > 0) {
      await db
        .from("listings")
        .update({ is_active: false, gone_at: new Date().toISOString() })
        .eq("id", candidate.id);
      keptFavorite++;
    } else {
      await db.from("listings").delete().eq("id", candidate.id);
      deleted++;
    }
  }

  console.log(
    `[runner] gone-check ${sourceId}: checked ${checked}, gone ${goneCount}, deleted ${deleted}, kept-favourite ${keptFavorite}`
  );
  return null;
}

/**
 * Deletes a favourited-but-gone listing (`gone_at` set — see
 * checkGoneListings) once it's been sitting that way for
 * GONE_FAVORITE_RETENTION_DAYS: the user has had a chance to see "Prodáno /
 * nedostupné od <datum>" on the Oblíbené page, so it's swept away like any
 * other gone listing would have been immediately if it hadn't been
 * favourited. Cascades to `favorites`/`price_history`/`matches` via FK.
 */
async function deleteExpiredGoneFavorites(db: DbClient): Promise<void> {
  const cutoff = new Date(
    Date.now() - GONE_FAVORITE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await db
    .from("listings")
    .delete()
    .lt("gone_at", cutoff)
    .select("id");
  if (error) {
    console.warn("[runner] failed to delete expired gone favourites:", error.message);
    return;
  }
  if (data && data.length > 0) {
    console.log(`[runner] deleted ${data.length} favourited listing(s) gone for ${GONE_FAVORITE_RETENTION_DAYS}+ days`);
  }
}

/**
 * Deletes listings that no search currently matches (no row in `matches`)
 * and that haven't been (re-)fetched in a while. The age cutoff exists so a
 * listing that briefly stops matching right after a search is edited isn't
 * lost immediately — it gets a few days' grace before being swept up here.
 * A favourited listing (row in `public.favorites`) is NEVER deleted here,
 * matched or not — see README.md "Oblíbené".
 *
 * `price_history`/`matches`/`favorites` rows for a deleted listing
 * cascade-delete via their FK (`on delete cascade`, see
 * supabase/migrations/20260928120000_init.sql and 20260928220000_favorites.sql),
 * so deleting from `listings` is sufficient.
 *
 * Paginates with a keyset cursor on `id` (not offset) so deletions made
 * mid-scan never cause rows to be skipped or re-scanned.
 */
async function cleanupUnmatchedListings(db: DbClient): Promise<void> {
  const cutoff = new Date(
    Date.now() - CLEANUP_UNMATCHED_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  let totalDeleted = 0;
  let cursor: string | null = null;

  for (;;) {
    let query = db
      .from("listings")
      .select("id, matches(id), favorites(user_id)")
      .lt("last_seen", cutoff)
      .order("id", { ascending: true })
      .limit(CLEANUP_BATCH_SIZE);
    if (cursor) query = query.gt("id", cursor);

    const { data, error } = await query;
    if (error) {
      console.warn("[runner] cleanup: failed to load candidate listings:", error.message);
      break;
    }
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      matches: { id: string }[] | null;
      favorites: { user_id: string }[] | null;
    }>;
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    const unmatchedIds = rows
      .filter((r) => (!r.matches || r.matches.length === 0) && (!r.favorites || r.favorites.length === 0))
      .map((r) => r.id);
    if (unmatchedIds.length > 0) {
      const { error: deleteError } = await db.from("listings").delete().in("id", unmatchedIds);
      if (deleteError) {
        console.warn("[runner] cleanup: failed to delete listings batch:", deleteError.message);
      } else {
        totalDeleted += unmatchedIds.length;
      }
    }

    if (rows.length < CLEANUP_BATCH_SIZE) break;
  }

  console.log(
    `[runner] cleanup: deleted ${totalDeleted} listing(s) unmatched by any search and not seen for ${CLEANUP_UNMATCHED_AFTER_DAYS}+ days`
  );
}

/**
 * Resolves a user's Auth e-mail via the admin API (service-role only —
 * `db` here is always the service-role client, see `runScrape`). Returns
 * null (never throws) if the lookup fails or the user has no e-mail on
 * file — the caller logs and skips that user's digest rather than falling
 * back to any other address (see task note: a user whose e-mail can't be
 * resolved is skipped, not redirected to the admin address).
 */
export async function resolveUserEmail(db: DbClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email;
  } catch (err) {
    console.warn(`[notify] failed to resolve e-mail for user ${userId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Only matches created since the last notification get notified (the
 * `notified_at is null` filter below) — so running the scraper 3x/day (see
 * .github/workflows/scrape.yml) never resends anything already reported,
 * and a run with nothing new simply sends nothing (see sendMatchDigestEmail
 * / sendPushToUser's own "nothing to send" no-ops).
 *
 * The digest e-mail is per-user (see sendMatchDigestEmail's doc comment):
 * every search-group and favourite-change is bucketed by its owning user,
 * that user's Auth e-mail is resolved via `resolveUserEmail`, and one
 * digest is sent per user. `matches.notified_at` is only stamped for the
 * matches belonging to a user whose digest actually sent successfully — a
 * user with no resolvable e-mail, or whose send failed (e.g. the Resend
 * free-tier "only the account owner" limitation), is logged and skipped,
 * and their matches stay unnotified so the next run retries them. Push
 * (below) is unaffected either way — it's sent independently per search.
 *
 * `userFilter` (set for a user-scoped manual run — see RunOptions.
 * userFilter) restricts BOTH the matches query and the favourites-alert
 * events to that one user, so a manual "Spustit scraping mych hledani" run
 * never e-mails/pushes anyone else — including any leftover unnotified
 * matches from an earlier cron run that happen to belong to a different
 * user and would otherwise be picked up by this same "notified_at is null"
 * query.
 */
export async function notifyNewMatches(
  db: DbClient,
  vapid: VapidConfig | null,
  userFilter?: string
): Promise<void> {
  let pendingQuery = db
    .from("matches")
    .select("id, search_id, listing_id, searches!inner(name, notify, user_id), listings(*)")
    .is("notified_at", null)
    .eq("searches.notify", true);
  if (userFilter) pendingQuery = pendingQuery.eq("searches.user_id", userFilter);
  const { data: pending, error } = await pendingQuery;

  if (error) {
    console.warn("[runner] failed to load pending matches for notification:", error.message);
    return;
  }
  const rows = (pending ?? []) as unknown as Array<{
    id: string;
    search_id: string;
    searches: { name: string; notify: boolean; user_id: string };
    listings: Record<string, unknown> | null;
  }>;

  interface SearchGroup extends NotifySearchGroup {
    userId: string;
  }
  const groupsBySearch = new Map<string, SearchGroup>();
  for (const row of rows) {
    if (!row.listings) continue;
    const l = row.listings as {
      title: string;
      url: string;
      source: string;
      price_czk: number | null;
      year: number | null;
      mileage_km: number | null;
      fuel: string | null;
      image_urls: string[];
    };
    const group = groupsBySearch.get(row.search_id) ?? {
      searchName: row.searches.name,
      userId: row.searches.user_id,
      listings: [],
    };
    group.listings.push({
      title: l.title,
      url: l.url,
      source: l.source,
      priceCzk: l.price_czk,
      year: l.year,
      mileageKm: l.mileage_km,
      fuel: l.fuel,
      imageUrl: l.image_urls?.[0] ?? null,
    });
    groupsBySearch.set(row.search_id, group);
  }

  // Favourites alerts (price drop / gone — see favorites-alert.ts) ride
  // along on the same digest e-mail as a separate section, and get their
  // own push per owner below. Independent of whether there are any new
  // matches at all this run. `checkFavoritesAlerts` itself scans every
  // user's favourites (its tracking-column bookkeeping is harmless to run
  // regardless of scope) — but a user-scoped run's events are filtered down
  // to just that user below, same as the matches query above, so no other
  // user gets notified from it.
  const favoriteEventsAll = await checkFavoritesAlerts(db);
  const favoriteEvents = userFilter
    ? favoriteEventsAll.filter((e) => e.userId === userFilter)
    : favoriteEventsAll;
  const favoriteChanges: NotifyFavoriteChange[] = favoriteEvents.map((e) => e.change);

  if (rows.length === 0 && favoriteChanges.length === 0) {
    console.log("[notify] nothing to notify (no new matches, no favourite changes)");
    return;
  }

  interface UserDigest {
    groups: NotifySearchGroup[];
    favoriteChanges: NotifyFavoriteChange[];
    matchIds: string[];
  }
  const digestsByUser = new Map<string, UserDigest>();
  function digestFor(userId: string): UserDigest {
    let d = digestsByUser.get(userId);
    if (!d) {
      d = { groups: [], favoriteChanges: [], matchIds: [] };
      digestsByUser.set(userId, d);
    }
    return d;
  }
  for (const [searchId, group] of groupsBySearch) {
    if (group.listings.length === 0) continue;
    const d = digestFor(group.userId);
    d.groups.push({ searchName: group.searchName, listings: group.listings });
    for (const row of rows) {
      if (row.search_id === searchId) d.matchIds.push(row.id);
    }
  }
  for (const event of favoriteEvents) {
    digestFor(event.userId).favoriteChanges.push(event.change);
  }

  const emailConfig = await loadEmailSenderConfig(db);
  for (const [userId, digest] of digestsByUser) {
    const email = await resolveUserEmail(db, userId);
    if (!email) {
      console.warn(`[notify] no e-mail on file for user ${userId}, skipping their digest`);
      continue;
    }
    const sent = await sendMatchDigestEmail(email, digest.groups, digest.favoriteChanges, emailConfig);
    if (sent && digest.matchIds.length > 0) {
      await db.from("matches").update({ notified_at: new Date().toISOString() }).in("id", digest.matchIds);
    }
  }

  // Push: one notification per search with new matches, to that search's
  // owner — "Nové auto: <title> – <price>" for a single new match, or
  // "N nových aut pro <search>" for several, linking to that search's
  // /results view.
  for (const [searchId, group] of groupsBySearch) {
    if (group.listings.length === 0) continue;
    const title =
      group.listings.length === 1
        ? `Nové auto: ${group.listings[0]!.title} – ${group.listings[0]!.priceCzk?.toLocaleString("cs-CZ") ?? "?"} Kč`
        : `${group.listings.length} nových aut pro ${group.searchName}`;
    try {
      await sendPushToUser(db, vapid, group.userId, {
        title,
        body: group.searchName,
        url: `/results?search=${searchId}`,
      });
    } catch (err) {
      console.warn(`[notify] push failed for search ${searchId}:`, (err as Error).message);
    }
  }

  await sendFavoritesAlertPush(db, vapid, favoriteEvents);
}
