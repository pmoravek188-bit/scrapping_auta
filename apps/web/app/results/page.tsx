import Link from "next/link";
import { X } from "lucide-react";
import {
  ALL_FEATURE_GROUPS,
  hasAllFeatures,
  mergeMakeModelCatalog,
  mergeMakes,
  normalizeMake,
  normalizeModel,
  type BodyType,
  type DriveType,
  type FuelType,
  type TransmissionType,
} from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { ResultRow, type ResultRowData } from "./result-row";
import { ResultsFiltersPanel } from "@/components/results-filters-panel";
import { SaveSearchButton } from "@/components/save-search-button";
import { MarkSeenButton } from "@/components/mark-seen-button";
import { touchResultsSeen } from "@/app/actions/user-state";
import { BODY_LABELS, DRIVE_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "@/lib/format";
import { formatPriceStep, formatMileageStep, formatPowerStep, SORT_LABELS, type SortKey } from "@/lib/filter-options";

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
 * /results, reworked (task B):
 *  - Default scope ("Všechna auta") queries public.listings directly for
 *    ANY active listing, not just ones already matched to a saved search.
 *  - "Moje hledání: <name>" scope filters to that search's matches.
 *  - Both scopes share the same `search_listings` security-invoker RPC
 *    (supabase/migrations/20260928200000_results_rework.sql), which applies
 *    every numeric/enum filter, dedupes by group_id (cheapest offer per
 *    group), flags is_new, sorts and paginates — one accurate
 *    `count(*) over()` per call.
 *
 * KNOWN LIMITATION (documented per the task brief): "Výbava"/"Verze" feature
 * chips can't be expressed as an exact SQL predicate (whole-token matching
 * lives in packages/core's text-match.ts). The RPC's `p_text_terms` is an
 * OR'd ILIKE prefilter across every synonym of every ticked feature; this
 * page then re-checks each returned row with `hasAllFeatures` (AND across
 * the ticked features, whole-token) before rendering. When 2+ feature chips
 * are ticked this can legitimately drop a few rows from a page (a row could
 * satisfy the OR-prefilter via feature A's synonym without ever containing
 * feature B), so `total_count`/page count become an upper bound rather than
 * exact in that case — see README.md "Known limitations".
 */
export default async function ResultsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;

  const searchId = one(params, "search") || null;
  const sort = one(params, "sort") || "newest";
  const sortKey = (sort in SORT_LABELS ? sort : "newest") as SortKey;
  const page = Math.max(1, Number(one(params, "page")) || 1);
  const onlyNew = one(params, "only_new") === "1";

  const rawMake = one(params, "make");
  const make = normalizeMake(rawMake) ?? "";
  const model = normalizeModel(one(params, "model"), rawMake) ?? "";
  const priceFrom = one(params, "price_from");
  const priceTo = one(params, "price_to");
  const yearFrom = one(params, "year_from");
  const yearTo = one(params, "year_to");
  const mileageMax = one(params, "mileage_max");
  const powerMinKw = one(params, "power_min_kw");
  const transmission = one(params, "transmission") as TransmissionType | "";
  const fuel = many(params, "fuel") as FuelType[];
  const body = many(params, "body") as BodyType[];
  const sources = many(params, "sources");
  const drive = many(params, "drive") as DriveType[];
  const features = many(params, "features");

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: searches }, { data: sourceRows }, { data: makeModelRows }, seen] = await Promise.all([
    supabase.from("searches").select("id, name").order("created_at"),
    supabase.from("sources").select("id, name").eq("enabled", true).order("name"),
    supabase.from("make_models").select("make, model, listing_count"),
    touchResultsSeen(),
  ]);

  const makes = mergeMakes(makeModelRows ?? []);
  const makeModels = mergeMakeModelCatalog(makeModelRows ?? []);
  const availableSources = sourceRows ?? [];
  const currentSearch = searchId ? (searches ?? []).find((s) => s.id === searchId) : null;

  // Union of synonyms for every ticked feature/version chip -- an OR'd ILIKE
  // prefilter for the RPC (see the module doc above for why this isn't exact).
  const textTerms = features.flatMap((id) => ALL_FEATURE_GROUPS.find((g) => g.id === id)?.synonyms ?? []);

  const { data: rpcRows, error } = await supabase.rpc("search_listings", {
    p_search_id: searchId,
    p_make: make || null,
    p_model: model || null,
    p_price_from: priceFrom ? Number(priceFrom) : null,
    p_price_to: priceTo ? Number(priceTo) : null,
    p_year_from: yearFrom ? Number(yearFrom) : null,
    p_year_to: yearTo ? Number(yearTo) : null,
    p_mileage_max: mileageMax ? Number(mileageMax) : null,
    p_power_min_kw: powerMinKw ? Number(powerMinKw) : null,
    p_fuel: fuel.length > 0 ? fuel : null,
    p_body: body.length > 0 ? body : null,
    p_transmission: transmission || null,
    p_sources: sources.length > 0 ? sources : null,
    p_drive: drive.length > 0 ? drive : null,
    p_text_terms: textTerms.length > 0 ? textTerms : null,
    p_only_new: onlyNew,
    p_seen_prev: seen.seenPrev,
    p_sort: sortKey,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });

  type RpcRow = NonNullable<typeof rpcRows>[number];
  let rows: RpcRow[] = rpcRows ?? [];
  const totalCount = rows[0]?.total_count ?? 0;

  // Exact whole-token AND check for ticked feature/version chips (see module
  // doc: the RPC only ran an OR'd substring prefilter).
  if (features.length > 0) {
    rows = rows.filter((r) => {
      const haystack = `${r.title} ${r.variant ?? ""} ${(r.equipment ?? []).join(" ")}`;
      return hasAllFeatures(haystack, features);
    });
  }

  const listingIds = rows.map((r) => r.id);
  const priceDropIds = new Set<string>();
  const favoriteIds = new Set<string>();
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
      .order("seen_at", { ascending: false });
    const seenPerListing = new Map<string, number[]>();
    for (const h of history ?? []) {
      if (h.price_czk == null) continue;
      const list = seenPerListing.get(h.listing_id) ?? [];
      if (list.length < 2) list.push(h.price_czk);
      seenPerListing.set(h.listing_id, list);
    }
    for (const [id, prices] of seenPerListing) {
      if (prices.length === 2 && prices[0] < prices[1]) priceDropIds.add(id);
    }
  }

  const activeFilters: { label: string; href: string }[] = [];
  function removeParam(...keys: string[]): string {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (keys.includes(k) || k === "page") continue;
      const values = Array.isArray(v) ? v : v ? [v] : [];
      for (const val of values) next.append(k, val);
    }
    return `/results?${next.toString()}`;
  }
  if (make) activeFilters.push({ label: makes.find((m) => m.slug === make)?.label ?? make, href: removeParam("make", "model") });
  if (model) activeFilters.push({ label: makeModels[make]?.find((m) => m.slug === model)?.label ?? model, href: removeParam("model") });
  if (priceFrom) activeFilters.push({ label: `od ${formatPriceStep(Number(priceFrom))}`, href: removeParam("price_from") });
  if (priceTo) activeFilters.push({ label: `do ${formatPriceStep(Number(priceTo))}`, href: removeParam("price_to") });
  if (yearFrom) activeFilters.push({ label: `rok od ${yearFrom}`, href: removeParam("year_from") });
  if (yearTo) activeFilters.push({ label: `rok do ${yearTo}`, href: removeParam("year_to") });
  if (mileageMax) activeFilters.push({ label: `do ${formatMileageStep(Number(mileageMax))}`, href: removeParam("mileage_max") });
  if (powerMinKw) activeFilters.push({ label: `od ${formatPowerStep(Number(powerMinKw))}`, href: removeParam("power_min_kw") });
  if (transmission) activeFilters.push({ label: TRANSMISSION_LABELS[transmission] ?? transmission, href: removeParam("transmission") });
  for (const f of fuel) activeFilters.push({ label: FUEL_LABELS[f] ?? f, href: removeParam("fuel") });
  for (const b of body) activeFilters.push({ label: BODY_LABELS[b] ?? b, href: removeParam("body") });
  for (const d of drive) activeFilters.push({ label: DRIVE_LABELS[d] ?? d, href: removeParam("drive") });
  for (const ft of features) {
    activeFilters.push({
      label: ALL_FEATURE_GROUPS.find((g) => g.id === ft)?.label ?? ft,
      href: removeParam("features"),
    });
  }
  for (const s of sources) activeFilters.push({ label: availableSources.find((x) => x.id === s)?.name ?? s, href: removeParam("sources") });
  if (onlyNew) activeFilters.push({ label: "Jen nové", href: removeParam("only_new") });

  const extraParams: Record<string, string | undefined> = {
    search: searchId || undefined,
    sort: sortKey,
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  function pageHref(p: number): string {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "page") continue;
      const values = Array.isArray(v) ? v : v ? [v] : [];
      for (const val of values) next.append(k, val);
    }
    if (p > 1) next.set("page", String(p));
    return `/results?${next.toString()}`;
  }

  const currentFilters = {
    make: make || null,
    model: model || null,
    year_from: yearFrom ? Number(yearFrom) : null,
    year_to: yearTo ? Number(yearTo) : null,
    price_from: priceFrom ? Number(priceFrom) : null,
    price_to: priceTo ? Number(priceTo) : null,
    mileage_max: mileageMax ? Number(mileageMax) : null,
    power_min_kw: powerMinKw ? Number(powerMinKw) : null,
    fuel,
    body,
    transmission: transmission || null,
    sources,
    drive,
    features,
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Výsledky</h1>
          <p className="text-sm text-gray-500">
            {error
              ? "Nepodařilo se načíst výsledky."
              : `Nalezeno ${totalCount}${features.length > 0 ? " (přibližně)" : ""} nabídek`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveSearchButton filters={currentFilters} />
          <MarkSeenButton />
          <form className="flex flex-wrap gap-2 text-sm" method="get">
            {searchId && <input type="hidden" name="search" value={searchId} />}
            <select name="sort" defaultValue={sortKey} className="input w-auto">
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

      {/* Scope switch (task B): "Všechna auta" scans public.listings
          directly; each search tab scans that search's matches. */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          href="/results"
          className={`rounded-full border px-3 py-1 ${!searchId ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300 bg-white"}`}
        >
          Všechna auta
        </Link>
        {(searches ?? []).map((s) => (
          <Link
            key={s.id}
            href={`/results?search=${s.id}`}
            className={`rounded-full border px-3 py-1 ${searchId === s.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300 bg-white"}`}
          >
            Moje hledání: {s.name}
          </Link>
        ))}
      </div>

      {searchId && !currentSearch && (
        <div className="mb-4 card text-sm text-amber-700">
          Toto hledání neexistuje nebo vám nepatří — zobrazena jsou "Všechna auta".
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {activeFilters.map((f, i) => (
            <Link key={i} href={f.href} className="chip chip-active hover:bg-brand-100">
              {f.label}
              <X className="h-3 w-3" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <ResultsFiltersPanel
          initial={{
            make,
            model,
            price_from: priceFrom,
            price_to: priceTo,
            year_from: yearFrom,
            year_to: yearTo,
            mileage_max: mileageMax,
            power_min_kw: powerMinKw,
            fuel,
            body,
            transmission,
            sources,
            drive,
            features,
            only_new: onlyNew,
          }}
          makes={makes}
          makeModels={makeModels}
          availableSources={availableSources}
          extraParams={extraParams}
          activeCount={activeFilters.length}
        />

        <div className="min-w-0 flex-1">
          {rows.length === 0 ? (
            <div className="card text-sm text-gray-600">Žádné výsledky. Zkuste upravit filtry.</div>
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
                    <Link href={pageHref(page - 1)} className="btn-secondary">
                      Předchozí
                    </Link>
                  )}
                  <span className="text-gray-500">
                    Strana {page} z {totalPages}
                  </span>
                  {page < totalPages && (
                    <Link href={pageHref(page + 1)} className="btn">
                      Načíst další
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
