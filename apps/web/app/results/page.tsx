import Link from "next/link";
import { Plus } from "lucide-react";
import { summarizeListingHistory } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { ResultRow, type ResultRowData } from "./result-row";
import { MarkSeenButton } from "@/components/mark-seen-button";
import { ScrapeTrigger } from "@/components/scrape-trigger";
import { currentUserIsAdmin } from "@/lib/admin";
import { touchResultsSeen } from "@/app/actions/user-state";
import { fetchPriceEvaluations } from "@/lib/price-evaluation.server";
import { SORT_LABELS, type SortKey } from "@/lib/filter-options";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function many(params: Params, key: string): string[] {
  const v = params[key];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * /results, simplified: the DB only ever holds listings that matched some
 * saved search (a few models, ~1,100 cars), so a full make/model/price/...
 * filter panel over that small set was pointless. The page is now just:
 * a search-switcher ("Vše" + one chip per saved search), sort, "jen nové",
 * an optional compact source filter, and pagination — all driven by the
 * same `search_listings` RPC (supabase/migrations/20260928200000_results_rework.sql)
 * with every removed filter param passed as null.
 */
export default async function ResultsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;

  const searchId = one(params, "search") || null;
  const sort = one(params, "sort") || "newest";
  const sortKey = (sort in SORT_LABELS ? sort : "newest") as SortKey;
  const page = Math.max(1, Number(one(params, "page")) || 1);
  const onlyNew = one(params, "only_new") === "1";
  const sources = many(params, "sources");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;
  const admin = await currentUserIsAdmin(supabase);

  const [{ data: searches }, { data: sourceRows }, { data: matchRows }, seen] = await Promise.all([
    supabase.from("searches").select("id, name").order("created_at"),
    supabase.from("sources").select("id, name").eq("enabled", true).order("name"),
    // One query for every search's match count (RLS already limits this to
    // the current user's own searches) -- cheap at ~1,100 rows total.
    supabase.from("matches").select("search_id").neq("status", "hidden"),
    touchResultsSeen(),
  ]);

  const availableSources = sourceRows ?? [];
  const currentSearch = searchId ? (searches ?? []).find((s) => s.id === searchId) : null;

  const matchCounts = new Map<string, number>();
  for (const m of matchRows ?? []) {
    matchCounts.set(m.search_id, (matchCounts.get(m.search_id) ?? 0) + 1);
  }

  /** Builds a /results href from the current search/sort/only_new/sources
   * state plus overrides, dropping any other (old/unsupported) query param
   * and resetting the page unless a page override is given. */
  function hrefWith(overrides: {
    search?: string | null;
    sort?: SortKey;
    onlyNew?: boolean;
    sources?: string[];
    page?: number;
  }): string {
    const next = new URLSearchParams();
    const merged = {
      search: overrides.search !== undefined ? overrides.search : searchId,
      sort: overrides.sort ?? sortKey,
      onlyNew: overrides.onlyNew ?? onlyNew,
      sources: overrides.sources ?? sources,
      page: overrides.page ?? 1,
    };
    if (merged.search) next.set("search", merged.search);
    next.set("sort", merged.sort);
    if (merged.onlyNew) next.set("only_new", "1");
    for (const s of merged.sources) next.append("sources", s);
    if (merged.page > 1) next.set("page", String(merged.page));
    const qs = next.toString();
    return qs ? `/results?${qs}` : "/results";
  }

  function toggleSourceHref(id: string): string {
    const next = sources.includes(id) ? sources.filter((s) => s !== id) : [...sources, id];
    return hrefWith({ sources: next });
  }

  const { data: rpcRows, error } = await supabase.rpc("search_listings", {
    p_search_id: searchId,
    p_make: null,
    p_model: null,
    p_price_from: null,
    p_price_to: null,
    p_year_from: null,
    p_year_to: null,
    p_mileage_max: null,
    p_power_min_kw: null,
    p_fuel: null,
    p_body: null,
    p_transmission: null,
    p_sources: sources.length > 0 ? sources : null,
    p_drive: null,
    p_text_terms: null,
    p_only_new: onlyNew,
    p_seen_prev: seen.seenPrev,
    p_sort: sortKey,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });

  type RpcRow = NonNullable<typeof rpcRows>[number];
  const rows: RpcRow[] = rpcRows ?? [];
  const totalCount = rows[0]?.total_count ?? 0;

  const listingIds = rows.map((r) => r.id);
  const priceDropIds = new Set<string>();
  const favoriteIds = new Set<string>();
  const historyByListing = new Map<string, { price_czk: number | null; seen_at: string }[]>();
  if (listingIds.length > 0) {
    // Own favourites (public.favorites, RLS owner-only) for the listings on
    // this page — used below to render each card's heart state.
    const { data: favoriteRows } = await supabase
      .from("favorites")
      .select("listing_id")
      .in("listing_id", listingIds);
    for (const f of favoriteRows ?? []) favoriteIds.add(f.listing_id);
  }
  if (listingIds.length > 0) {
    const { data: history } = await supabase
      .from("price_history")
      .select("listing_id, price_czk, seen_at")
      .in("listing_id", listingIds)
      .order("seen_at", { ascending: true });
    const lastTwoPerListing = new Map<string, number[]>();
    for (const h of history ?? []) {
      const list = historyByListing.get(h.listing_id) ?? [];
      list.push({ price_czk: h.price_czk, seen_at: h.seen_at });
      historyByListing.set(h.listing_id, list);
      if (h.price_czk == null) continue;
      // Last two known prices, chronological order (oldest kept first) — a
      // decrease between them flags the "zlevněno" badge.
      const lastTwo = lastTwoPerListing.get(h.listing_id) ?? [];
      lastTwo.push(h.price_czk);
      if (lastTwo.length > 2) lastTwo.shift();
      lastTwoPerListing.set(h.listing_id, lastTwo);
    }
    for (const [id, prices] of lastTwoPerListing) {
      if (prices.length === 2 && prices[0]! < prices[1]!) priceDropIds.add(id);
    }
  }

  const priceEvaluations = await fetchPriceEvaluations(
    supabase,
    rows.map((r) => ({
      id: r.id,
      make: r.make,
      model: r.model,
      year: r.year,
      mileageKm: r.mileage_km,
      priceCzk: r.price_czk,
    }))
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Výsledky</h1>
          <p className="text-sm text-gray-500">
            {error ? "Nepodařilo se načíst výsledky." : `Nalezeno ${totalCount} nabídek`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MarkSeenButton />
          <form className="flex flex-wrap gap-2 text-sm" method="get">
            {searchId && <input type="hidden" name="search" value={searchId} />}
            {onlyNew && <input type="hidden" name="only_new" value="1" />}
            {sources.map((s) => (
              <input key={s} type="hidden" name="sources" value={s} />
            ))}
            <select name="sort" defaultValue={sortKey} className="input !w-auto">
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-secondary">
              Seřadit
            </button>
          </form>
        </div>
      </div>

      {/* Search switcher: "Vše" scans public.listings directly; each chip
          scans that search's matches. Chips wrap onto more lines so they never
          cause page overflow on narrow screens. */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href={hrefWith({ search: null })}
            className={`whitespace-nowrap rounded-full border px-3 py-1 ${!searchId ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300 bg-white"}`}
          >
            Vše
          </Link>
          {(searches ?? []).map((s) => {
            const count = matchCounts.get(s.id);
            return (
              <Link
                key={s.id}
                href={hrefWith({ search: s.id })}
                className={`whitespace-nowrap rounded-full border px-3 py-1 ${searchId === s.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300 bg-white"}`}
              >
                {s.name}
                {count !== undefined ? ` (${count})` : ""}
              </Link>
            );
          })}
          <Link
            href="/searches/new"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-gray-300 bg-white px-3 py-1 text-gray-600 hover:border-brand-500 hover:text-brand-700"
          >
            <Plus className="h-3 w-3" aria-hidden />
            Nové hledání
          </Link>
        </div>
      </div>

      {searchId && !currentSearch && (
        <div className="mb-4 card text-sm text-amber-700">
          Toto hledání neexistuje nebo vám nepatří — zobrazena jsou "Vše".
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={hrefWith({ onlyNew: !onlyNew })}
          className={`chip ${onlyNew ? "chip-active" : "chip-inactive"}`}
        >
          Jen nové
        </Link>
        {availableSources.map((s) => (
          <Link
            key={s.id}
            href={toggleSourceHref(s.id)}
            className={`chip ${sources.includes(s.id) ? "chip-active" : "chip-inactive"}`}
          >
            {s.name}
          </Link>
        ))}
      </div>

      <div className="min-w-0">
        {rows.length === 0 ? (
          <div className="card space-y-3 text-sm text-gray-600">
            {(searches ?? []).length === 0 ? (
              <p>
                Zatím nemáš žádné hledání.{" "}
                <Link href="/searches/new" className="font-medium text-brand-600 underline">
                  Založ si první hledání
                </Link>{" "}
                a auta se začnou hledat při nejbližším scrapingu.
              </p>
            ) : (
              <p>Zatím nic. Scraping běží 3× denně (7, 13 a 19 h).</p>
            )}
            {admin && <ScrapeTrigger sources={availableSources} />}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => {
                const listing: ResultRowData["listing"] = {
                  id: r.id,
                  title: r.title,
                  url: r.url,
                  source: r.source,
                  price_czk: r.price_czk,
                  year: r.year,
                  mileage_km: r.mileage_km,
                  fuel: r.fuel,
                  transmission: r.transmission,
                  power_kw: r.power_kw,
                  location: r.location,
                  image_urls: r.image_urls ?? [],
                  drive: r.drive,
                  group_id: r.group_id,
                  price_dropped: priceDropIds.has(r.id),
                  is_new: r.is_new,
                  priceEvaluation: priceEvaluations.get(r.id),
                  history: summarizeListingHistory(
                    r.first_seen,
                    (historyByListing.get(r.id) ?? []).map((h) => ({ priceCzk: h.price_czk, seenAt: h.seen_at }))
                  ),
                };
                return (
                  <ResultRow
                    key={r.match_id ?? r.id}
                    matchId={r.match_id ?? undefined}
                    status={r.match_status ?? undefined}
                    listing={listing}
                    offerCount={r.group_offer_count}
                    favorite={favoriteIds.has(r.id)}
                  />
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2 text-sm">
                {page > 1 && (
                  <Link href={hrefWith({ page: page - 1 })} className="btn-secondary">
                    Předchozí
                  </Link>
                )}
                <span className="text-gray-500">
                  Strana {page} z {totalPages}
                </span>
                {page < totalPages && (
                  <Link href={hrefWith({ page: page + 1 })} className="btn">
                    Načíst další
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
