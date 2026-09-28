import Link from "next/link";
import { X } from "lucide-react";
import {
  mergeMakeModelCatalog,
  mergeMakes,
  normalizeMake,
  normalizeModel,
  type BodyType,
  type FuelType,
  type TransmissionType,
} from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { ResultRow, type ResultRowData } from "./result-row";
import { ResultsFiltersPanel } from "@/components/results-filters-panel";
import { BODY_LABELS, FUEL_LABELS, TRANSMISSION_LABELS } from "@/lib/format";
import { formatPriceStep, formatMileageStep, formatPowerStep, SORT_LABELS, type SortKey } from "@/lib/filter-options";

export const dynamic = "force-dynamic";

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

export default async function ResultsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;

  const searchId = one(params, "search");
  const sort = one(params, "sort") || "newest";
  const status = one(params, "status") || "active";
  const sortKey = (sort in SORT_LABELS ? sort : "newest") as SortKey;

  // Defensive normalization: URLs are generated from already-normalized
  // catalog slugs, but a hand-edited/stale link could carry raw values.
  const make = normalizeMake(one(params, "make")) ?? "";
  const model = normalizeModel(one(params, "model")) ?? "";
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

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: searches }, { data: sourceRows }, { data: makeModelRows }] = await Promise.all([
    supabase.from("searches").select("id, name").order("created_at"),
    supabase.from("sources").select("id, name").eq("enabled", true).order("name"),
    supabase.from("make_models").select("make, model, listing_count"),
  ]);

  const makes = mergeMakes(makeModelRows ?? []);
  const makeModels = mergeMakeModelCatalog(makeModelRows ?? []);
  const availableSources = sourceRows ?? [];

  let query = supabase
    .from("matches")
    .select("id, matched_at, status, search_id, listings!inner(*)")
    .limit(200);

  if (searchId) query = query.eq("search_id", searchId);
  if (status === "active") query = query.neq("status", "hidden");
  if (status === "favorite") query = query.eq("status", "favorite");

  if (make) query = query.eq("listings.make", make);
  if (model) query = query.eq("listings.model", model);
  if (priceFrom) query = query.gte("listings.price_czk", Number(priceFrom));
  if (priceTo) query = query.lte("listings.price_czk", Number(priceTo));
  if (yearFrom) query = query.gte("listings.year", Number(yearFrom));
  if (yearTo) query = query.lte("listings.year", Number(yearTo));
  if (mileageMax) query = query.lte("listings.mileage_km", Number(mileageMax));
  if (powerMinKw) query = query.gte("listings.power_kw", Number(powerMinKw));
  if (transmission) query = query.eq("listings.transmission", transmission);
  if (fuel.length > 0) query = query.in("listings.fuel", fuel);
  if (body.length > 0) query = query.in("listings.body", body);
  if (sources.length > 0) query = query.in("listings.source", sources);

  const { data: matches, error } = await query;

  type Row = {
    id: string;
    matched_at: string;
    status: string;
    listings: ResultRowData["listing"] | null;
  };
  let rows = ((matches ?? []) as unknown as Row[]).filter((r) => r.listings);

  rows = rows.sort((a, b) => {
    const la = a.listings!;
    const lb = b.listings!;
    switch (sortKey) {
      case "price_asc":
        return (la.price_czk ?? Infinity) - (lb.price_czk ?? Infinity);
      case "price_desc":
        return (lb.price_czk ?? -Infinity) - (la.price_czk ?? -Infinity);
      case "year_desc":
        return (lb.year ?? 0) - (la.year ?? 0);
      case "mileage_asc":
        return (la.mileage_km ?? Infinity) - (lb.mileage_km ?? Infinity);
      default:
        return new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime();
    }
  });

  // group offer counts (same group_id) among currently loaded rows, best-effort
  const groupCounts = new Map<string, number>();
  for (const r of rows) {
    const gid = r.listings?.group_id;
    if (!gid) continue;
    groupCounts.set(gid, (groupCounts.get(gid) ?? 0) + 1);
  }

  // price-drop badge: compare the two most recent price_history rows per listing
  const listingIds = rows.map((r) => r.listings!.id);
  const priceDropIds = new Set<string>();
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
      if (keys.includes(k)) continue;
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
  for (const f of fuel) {
    activeFilters.push({ label: FUEL_LABELS[f] ?? f, href: removeParam("fuel") });
  }
  for (const b of body) {
    activeFilters.push({ label: BODY_LABELS[b] ?? b, href: removeParam("body") });
  }
  for (const s of sources) {
    activeFilters.push({ label: availableSources.find((x) => x.id === s)?.name ?? s, href: removeParam("sources") });
  }

  const extraParams: Record<string, string | undefined> = {
    search: searchId || undefined,
    sort: sortKey,
    status,
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Výsledky</h1>
          <p className="text-sm text-gray-500">
            {error ? "Nepodařilo se načíst výsledky." : `Nalezeno ${rows.length}${rows.length >= 200 ? "+" : ""} nabídek`}
          </p>
        </div>
        <form className="flex flex-wrap gap-2 text-sm" method="get">
          {searchId && <input type="hidden" name="search" value={searchId} />}
          <select name="sort" defaultValue={sortKey} className="input w-auto">
            {Object.entries(SORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="active">Aktivní</option>
            <option value="favorite">Oblíbené</option>
            <option value="all">Vše</option>
          </select>
          <button type="submit" className="btn-secondary">
            Seřadit
          </button>
        </form>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          href="/results"
          className={`rounded-full border px-3 py-1 ${!searchId ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300 bg-white"}`}
        >
          Všechna hledání
        </Link>
        {(searches ?? []).map((s) => (
          <Link
            key={s.id}
            href={`/results?search=${s.id}`}
            className={`rounded-full border px-3 py-1 ${searchId === s.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300 bg-white"}`}
          >
            {s.name}
          </Link>
        ))}
      </div>

      {activeFilters.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {activeFilters.map((f, i) => (
            <Link
              key={i}
              href={f.href}
              className="chip chip-active hover:bg-brand-100"
            >
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => (
                <ResultRow
                  key={r.id}
                  matchId={r.id}
                  status={r.status}
                  listing={{ ...r.listings!, price_dropped: priceDropIds.has(r.listings!.id) }}
                  offerCount={groupCounts.get(r.listings!.group_id ?? "") ?? 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
