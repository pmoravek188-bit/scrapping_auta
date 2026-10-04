/**
 * Server-side batching for the price-evaluation badge ("Výhodná cena" /
 * "Cena odpovídá" / "Drahé"): the actual comparison (`evaluatePrice`) is a
 * pure function in packages/core — this file's only job is fetching
 * comparable listings cheaply, one query per DISTINCT (make, model) pair
 * across the listings being displayed, rather than one query per listing.
 */
import { evaluatePrice, type PriceEvaluation } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

export interface PriceEvaluationInput {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  priceCzk: number | null;
}

/**
 * Returns a Map keyed by listing id for every listing in `listings` that has
 * both a make and a model (an evaluation needs a peer group) — a listing
 * missing from the result either has no make/model, or didn't have enough
 * comparables (see `evaluatePrice`'s MIN_COMPARABLES). Listings with no
 * make/model are silently skipped (no query possible for them).
 */
export async function fetchPriceEvaluations(
  supabase: SupabaseClient,
  listings: PriceEvaluationInput[]
): Promise<Map<string, PriceEvaluation>> {
  const result = new Map<string, PriceEvaluation>();

  const groups = new Map<string, PriceEvaluationInput[]>();
  for (const listing of listings) {
    if (!listing.make || !listing.model) continue;
    const key = `${listing.make}\u0000${listing.model}`;
    const group = groups.get(key) ?? [];
    group.push(listing);
    groups.set(key, group);
  }
  if (groups.size === 0) return result;

  await Promise.all(
    Array.from(groups.entries()).map(async ([key, group]) => {
      const [make, model] = key.split("\u0000") as [string, string];
      const { data, error } = await supabase
        .from("listings")
        .select("id, price_czk, year, mileage_km")
        .eq("make", make)
        .eq("model", model)
        .eq("is_active", true);
      if (error || !data) return;

      const candidates = data.map((d) => ({ id: d.id, priceCzk: d.price_czk, year: d.year, mileageKm: d.mileage_km }));
      for (const listing of group) {
        const evaluation = evaluatePrice(
          { id: listing.id, priceCzk: listing.priceCzk, year: listing.year, mileageKm: listing.mileageKm },
          candidates
        );
        if (evaluation) result.set(listing.id, evaluation);
      }
    })
  );

  return result;
}
