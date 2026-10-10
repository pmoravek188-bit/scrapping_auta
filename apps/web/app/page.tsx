import Link from "next/link";
import { Search } from "lucide-react";
import { summarizeListingHistory } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { CarCard } from "@/components/car-card";
import { ScrapeTrigger } from "@/components/scrape-trigger";
import { fetchPriceEvaluations } from "@/lib/price-evaluation.server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: matches }, { data: sourceRows }, { data: favoriteRows }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, matched_at, status, searches(id, name), listings(*)")
      .neq("status", "hidden")
      .order("matched_at", { ascending: false })
      .limit(30),
    supabase.from("sources").select("id, name").eq("enabled", true).order("name"),
    // Own favourites (public.favorites, RLS owner-only) — used below to
    // render each card's heart state. See README.md "Oblíbené".
    supabase.from("favorites").select("listing_id"),
  ]);
  const favoriteIds = new Set((favoriteRows ?? []).map((f) => f.listing_id));

  const rows = (matches ?? []) as unknown as Array<{
    id: string;
    matched_at: string;
    status: string;
    searches: { id: string; name: string } | null;
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
      first_seen: string;
      currency_orig: string;
    } | null;
  }>;

  const listingsForEval = rows
    .filter((r) => r.listings)
    .map((r) => ({
      id: r.listings!.id,
      make: r.listings!.make,
      model: r.listings!.model,
      year: r.listings!.year,
      mileageKm: r.listings!.mileage_km,
      priceCzk: r.listings!.price_czk,
    }));
  const priceEvaluations = await fetchPriceEvaluations(supabase, listingsForEval);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Nejnovější nabídky</h1>
          <p className="text-sm text-gray-500">Poslední shody napříč všemi vašimi hledáními.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <ScrapeTrigger sources={sourceRows ?? []} />
          <Link href="/results" className="btn-secondary">
            <Search className="h-4 w-4" aria-hidden />
            Všechny výsledky
          </Link>
          <Link href="/searches" className="btn">
            Spravovat hledání
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-600">
          Zatím žádné shody. Vytvořte si{" "}
          <Link href="/searches/new" className="font-medium text-brand-600 underline">
            nové hledání
          </Link>
          , scraper je vyhodnotí při dalším běhu.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows
            .filter((r) => r.listings)
            .map((r) => (
              <div key={r.id}>
                {r.searches && (
                  <div className="mb-1.5 text-xs font-medium text-gray-400">{r.searches.name}</div>
                )}
                <CarCard
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
                    priceEvaluation: priceEvaluations.get(r.listings!.id),
                    history: summarizeListingHistory(r.listings!.first_seen, [], r.listings!.currency_orig),
                  }}
                  matchId={r.id}
                  favorite={favoriteIds.has(r.listings!.id)}
                  hideOnImageError
                />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
