import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  matchesSearch,
  normalizeListing,
  normalizeMake,
  normalizeModel,
  SearchQuerySchema,
  type Database,
  type Listing,
  type SearchQuery,
} from "@scrapping-auta/core";
import { getAdapter } from "./registry.js";
import { fetchEurCzkRate } from "./exchange-rate.js";
import { sendMatchDigestEmail, type NotifySearchGroup } from "./notify/email.js";
import { MAX_RESULT_PAGES } from "./http.js";
import { selectListingsToStore } from "./selection.js";

export type DbClient = SupabaseClient<Database>;

const INACTIVE_AFTER_DAYS = 3;
const CLEANUP_UNMATCHED_AFTER_DAYS = 3;
const CLEANUP_BATCH_SIZE = 200;

export interface RunOptions {
  dryRun?: boolean;
  sourceFilter?: string;
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
  return {
    id: row.id,
    // Saved searches can carry raw, un-normalized user input (e.g. a
    // trailing space, diacritics, or a display name instead of a slug) —
    // normalize here so every adapter and the matcher get a clean slug.
    make: normalizeMake(row.make),
    model: normalizeModel(row.model),
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
  return {
    ...parsed,
    make: normalizeMake(parsed.make),
    model: normalizeModel(parsed.model),
  };
}

export function createSupabaseClient(url: string, serviceRoleKey: string): DbClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
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
  if (db) {
    const { data: sourceRows, error } = await db
      .from("sources")
      .select("id, enabled")
      .eq("enabled", true);
    if (error) throw error;
    sourceIds = (sourceRows ?? []).map((s) => s.id);
  } else {
    sourceIds = Object.keys((await import("./registry.js")).ADAPTERS);
  }
  if (opts.sourceFilter) {
    sourceIds = sourceIds.filter((id) => id === opts.sourceFilter);
  }

  let searches: SearchRow[] = [];
  if (db) {
    const { data, error } = await db.from("searches").select("*").eq("enabled", true);
    if (error) throw error;
    searches = (data ?? []) as unknown as SearchRow[];
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

      const rawById = new Map<string, Awaited<ReturnType<typeof adapter.search>>[number]>();
      for (const query of queries) {
        try {
          const results = await adapter.search(query, {
            eurCzkRate,
            maxPages: MAX_RESULT_PAGES,
          });
          for (const r of results) rawById.set(r.sourceId, r);
        } catch (err) {
          console.warn(`[runner] ${sourceId} search failed for one query:`, (err as Error).message);
        }
      }
      found = rawById.size;

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
      const toStore = selectListingsToStore(normalized, searchQueriesForSource);

      if (dryRun || !db) {
        console.log(
          `[runner] [dry-run] ${sourceId}: fetched ${normalized.length}, ${toStore.length} match a saved search (would be stored)`
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
    } catch (err) {
      errorText = (err as Error).message;
      console.error(`[runner] ${sourceId} failed:`, errorText);
    }

    if (db) {
      const finishedAt = new Date().toISOString();
      await db.from("scrape_runs").insert({
        source: sourceId,
        started_at: startedAt,
        finished_at: finishedAt,
        found,
        new: newCount,
        errors: errorText,
      });
      await db
        .from("sources")
        .update({
          last_run_at: finishedAt,
          ...(errorText ? {} : { last_ok_at: finishedAt }),
          last_count: found,
        })
        .eq("id", sourceId);
    }
  }

  if (db && !dryRun) {
    const cutoff = new Date(Date.now() - INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.from("listings").update({ is_active: false }).lt("last_seen", cutoff).eq("is_active", true);

    // Only a full run (all sources) gets to decide a listing is genuinely
    // unmatched — a `--source` run only ever sees a slice of the enabled
    // searches' sources, so it can't tell "not matched by this source's
    // searches" from "not matched by any search at all".
    if (!opts.sourceFilter) {
      await cleanupUnmatchedListings(db);
    }

    await notifyNewMatches(db);
  }
}

/**
 * Deletes listings that no search currently matches (no row in `matches`)
 * and that haven't been (re-)fetched in a while. The age cutoff exists so a
 * listing that briefly stops matching right after a search is edited isn't
 * lost immediately — it gets a few days' grace before being swept up here.
 *
 * `price_history`/`matches` rows for a deleted listing cascade-delete via
 * their FK (`on delete cascade`, see supabase/migrations/20260928120000_init.sql),
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
      .select("id, matches(id)")
      .lt("last_seen", cutoff)
      .order("id", { ascending: true })
      .limit(CLEANUP_BATCH_SIZE);
    if (cursor) query = query.gt("id", cursor);

    const { data, error } = await query;
    if (error) {
      console.warn("[runner] cleanup: failed to load candidate listings:", error.message);
      break;
    }
    const rows = (data ?? []) as unknown as Array<{ id: string; matches: { id: string }[] | null }>;
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    const unmatchedIds = rows.filter((r) => !r.matches || r.matches.length === 0).map((r) => r.id);
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

async function notifyNewMatches(db: DbClient): Promise<void> {
  const { data: pending, error } = await db
    .from("matches")
    .select("id, search_id, listing_id, searches!inner(name, notify), listings(*)")
    .is("notified_at", null)
    .eq("searches.notify", true);

  if (error) {
    console.warn("[runner] failed to load pending matches for notification:", error.message);
    return;
  }
  const rows = (pending ?? []) as unknown as Array<{
    id: string;
    search_id: string;
    searches: { name: string; notify: boolean };
    listings: Record<string, unknown> | null;
  }>;
  if (rows.length === 0) {
    console.log("[notify] no pending matches to notify");
    return;
  }

  const groupsBySearch = new Map<string, NotifySearchGroup>();
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

  const sent = await sendMatchDigestEmail(Array.from(groupsBySearch.values()));
  if (sent) {
    const ids = rows.map((r) => r.id);
    await db.from("matches").update({ notified_at: new Date().toISOString() }).in("id", ids);
  }
}
