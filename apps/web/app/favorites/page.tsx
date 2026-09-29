import Link from "next/link";
import { Heart } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { FavoriteCard } from "@/components/favorite-card";

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
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const sortKey: SortKey = sort === "price" ? "price" : "date";

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: favorites } = await supabase
    .from("favorites")
    .select("listing_id, created_at, note, listings(*)")
    .order("created_at", { ascending: false });

  type Row = {
    listing_id: string;
    created_at: string;
    note: string | null;
    listings: {
      id: string;
      title: string;
      url: string;
      source: string;
      price_czk: number | null;
      year: number | null;
      mileage_km: number | null;
      fuel: string | null;
      transmission: string | null;
      power_kw: number | null;
      location: string | null;
      image_urls: string[];
      is_active: boolean;
    } | null;
  };
  let rows = ((favorites ?? []) as unknown as Row[]).filter((r) => r.listings);

  const listingIds = rows.map((r) => r.listing_id);
  // First known price at/after each favourite's created_at, to show a
  // "change since added" indicator.
  const priceAtAdd = new Map<string, number>();
  if (listingIds.length > 0) {
    const { data: history } = await supabase
      .from("price_history")
      .select("listing_id, price_czk, seen_at")
      .in("listing_id", listingIds)
      .order("seen_at", { ascending: true });
    const createdAtByListing = new Map(rows.map((r) => [r.listing_id, r.created_at]));
    for (const h of history ?? []) {
      if (h.price_czk == null || priceAtAdd.has(h.listing_id)) continue;
      const createdAt = createdAtByListing.get(h.listing_id);
      if (createdAt && h.seen_at >= createdAt) priceAtAdd.set(h.listing_id, h.price_czk);
    }
  }

  if (sortKey === "price") {
    rows = [...rows].sort((a, b) => (a.listings!.price_czk ?? Infinity) - (b.listings!.price_czk ?? Infinity));
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
          <Link
            href="/favorites?sort=date"
            className={`chip ${sortKey === "date" ? "chip-active" : ""}`}
          >
            Datum přidání
          </Link>
          <Link
            href="/favorites?sort=price"
            className={`chip ${sortKey === "price" ? "chip-active" : ""}`}
          >
            Cena
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-600">
          Zatím žádné oblíbené. Klikněte na srdíčko u nabídky, kterou chcete uložit.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <FavoriteCard
              key={r.listing_id}
              listing={r.listings!}
              createdAt={r.created_at}
              note={r.note}
              priceAtAdd={priceAtAdd.get(r.listing_id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
