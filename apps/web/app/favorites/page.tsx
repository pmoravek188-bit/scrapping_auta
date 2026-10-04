import Link from "next/link";
import { Heart } from "lucide-react";
import { summarizeListingHistory } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { FavoriteCard } from "@/components/favorite-card";
import { fetchPriceEvaluations } from "@/lib/price-evaluation.server";
import { FAVORITE_STATUS_LABELS, FAVORITE_STATUS_ORDER, type FavoriteStatus } from "@/lib/format";

export const dynamic = "force-dynamic";

type SortKey = "date" | "price";

/**
 * /favorites ("Oblíbené") — a standalone per-user list backed by
 * public.favorites (supabase/migrations/20260928220000_favorites.sql),
 * independent of any saved search. See README.md "Oblíbené".
 */
export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; status?: string }>;
}) {
  const { sort, status } = await searchParams;
  const sortKey: SortKey = sort === "price" ? "price" : "date";
  const statusFilter: FavoriteStatus | null =
    status && (FAVORITE_STATUS_ORDER as string[]).includes(status) ? (status as FavoriteStatus) : null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: favorites } = await supabase
    .from("favorites")
    .select("listing_id, created_at, note, status, listings(*)")
    .order("created_at", { ascending: false });

  type Row = {
    listing_id: string;
    created_at: string;
    note: string | null;
    status: FavoriteStatus;
    listings: {
      id: string;
      title: string;
      url: string;
      source: string;
      make: string | null;
      model: string | null;
      price_czk: number | null;
      year: number | null;
      mileage_km: number | null;
      fuel: string | null;
      transmission: string | null;
      power_kw: number | null;
      location: string | null;
      image_urls: string[];
      is_active: boolean;
      first_seen: string;
    } | null;
  };
  const allRows = ((favorites ?? []) as unknown as Row[]).filter((r) => r.listings);

  const statusCounts = new Map<FavoriteStatus, number>();
  for (const r of allRows) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);

  let rows = statusFilter ? allRows.filter((r) => r.status === statusFilter) : allRows;

  const listingIds = rows.map((r) => r.listing_id);
  // First known price at/after each favourite's created_at (for the "change
  // since added" indicator) and the full history (for "inzerováno N dní ·
  // zlevněno M×") — one query covers both.
  const priceAtAdd = new Map<string, number>();
  const historyByListing = new Map<string, { price_czk: number | null; seen_at: string }[]>();
  if (listingIds.length > 0) {
    const { data: history } = await supabase
      .from("price_history")
      .select("listing_id, price_czk, seen_at")
      .in("listing_id", listingIds)
      .order("seen_at", { ascending: true });
    const createdAtByListing = new Map(rows.map((r) => [r.listing_id, r.created_at]));
    for (const h of history ?? []) {
      const list = historyByListing.get(h.listing_id) ?? [];
      list.push({ price_czk: h.price_czk, seen_at: h.seen_at });
      historyByListing.set(h.listing_id, list);
      if (h.price_czk == null || priceAtAdd.has(h.listing_id)) continue;
      const createdAt = createdAtByListing.get(h.listing_id);
      if (createdAt && h.seen_at >= createdAt) priceAtAdd.set(h.listing_id, h.price_czk);
    }
  }

  const priceEvaluations = await fetchPriceEvaluations(
    supabase,
    rows.map((r) => ({
      id: r.listing_id,
      make: r.listings!.make,
      model: r.listings!.model,
      year: r.listings!.year,
      mileageKm: r.listings!.mileage_km,
      priceCzk: r.listings!.price_czk,
    }))
  );

  if (sortKey === "price") {
    rows = [...rows].sort((a, b) => (a.listings!.price_czk ?? Infinity) - (b.listings!.price_czk ?? Infinity));
  }

  function hrefWith(overrides: { sort?: SortKey; status?: FavoriteStatus | null }): string {
    const next = new URLSearchParams();
    next.set("sort", overrides.sort ?? sortKey);
    const nextStatus = overrides.status !== undefined ? overrides.status : statusFilter;
    if (nextStatus) next.set("status", nextStatus);
    return `/favorites?${next.toString()}`;
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Heart className="h-6 w-6 fill-red-500 text-red-500" aria-hidden />
            Oblíbené
          </h1>
          <p className="text-sm text-gray-500">{rows.length} uložených nabídek.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={hrefWith({ sort: "date" })} className={`chip ${sortKey === "date" ? "chip-active" : ""}`}>
            Datum přidání
          </Link>
          <Link href={hrefWith({ sort: "price" })} className={`chip ${sortKey === "price" ? "chip-active" : ""}`}>
            Cena
          </Link>
        </div>
      </div>

      {/* Status filter chips — wrap onto more lines rather than scrolling
          horizontally, per the mobile-first rule. */}
      <div className="mb-4 flex flex-wrap gap-1.5 text-sm">
        <Link href={hrefWith({ status: null })} className={`chip ${!statusFilter ? "chip-active" : "chip-inactive"}`}>
          Vše ({allRows.length})
        </Link>
        {FAVORITE_STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={hrefWith({ status: s })}
            className={`chip ${statusFilter === s ? "chip-active" : "chip-inactive"}`}
          >
            {FAVORITE_STATUS_LABELS[s]} ({statusCounts.get(s) ?? 0})
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-600">
          {allRows.length === 0
            ? "Zatím žádné oblíbené. Klikněte na srdíčko u nabídky, kterou chcete uložit."
            : "Žádné oblíbené v tomto stavu."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <FavoriteCard
              key={r.listing_id}
              listing={{
                id: r.listings!.id,
                title: r.listings!.title,
                url: r.listings!.url,
                source: r.listings!.source,
                price_czk: r.listings!.price_czk,
                year: r.listings!.year,
                mileage_km: r.listings!.mileage_km,
                fuel: r.listings!.fuel,
                transmission: r.listings!.transmission,
                power_kw: r.listings!.power_kw,
                location: r.listings!.location,
                image_urls: r.listings!.image_urls,
                is_active: r.listings!.is_active,
                priceEvaluation: priceEvaluations.get(r.listing_id),
                history: summarizeListingHistory(
                  r.listings!.first_seen,
                  (historyByListing.get(r.listing_id) ?? []).map((h) => ({
                    priceCzk: h.price_czk,
                    seenAt: h.seen_at,
                  }))
                ),
              }}
              createdAt={r.created_at}
              note={r.note}
              status={r.status}
              priceAtAdd={priceAtAdd.get(r.listing_id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
