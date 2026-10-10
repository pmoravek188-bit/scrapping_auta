import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { summarizeListingHistory } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { ListingGallery } from "@/components/listing-gallery";
import { FavoriteButton } from "@/components/favorite-button";
import { FavoriteStatusEditor } from "@/components/favorite-status-editor";
import { CompareToggle } from "@/components/compare-toggle";
import { BackButton } from "@/components/back-button";
import { PriceBadge } from "@/components/price-badge";
import { ListingHistoryLine } from "@/components/listing-history-line";
import { VinCheckLinks } from "@/components/vin-check-links";
import { fetchPriceEvaluations } from "@/lib/price-evaluation.server";
import { formatCzk, formatDateTime, formatKm, FUEL_LABELS, TRANSMISSION_LABELS, BODY_LABELS } from "@/lib/format";
import type { FavoriteStatus } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: listing } = await supabase.from("listings").select("*").eq("id", id).maybeSingle();
  if (!listing) notFound();

  const [{ data: priceHistory }, { data: otherOffers }, { data: favoriteRow }, priceEvaluations] =
    await Promise.all([
      supabase
        .from("price_history")
        .select("price_czk, price_orig, currency_orig, seen_at")
        .eq("listing_id", id)
        .order("seen_at", { ascending: true }),
      listing.group_id
        ? supabase
            .from("listings")
            .select("id, source, title, url, price_czk, is_active")
            .eq("group_id", listing.group_id)
            .neq("id", id)
        : Promise.resolve({ data: [] }),
      // RLS restricts this to the signed-in user's own row, so existence alone
      // tells us whether they've favourited this listing.
      supabase.from("favorites").select("listing_id, note, status").eq("listing_id", id).maybeSingle(),
      fetchPriceEvaluations(supabase, [
        {
          id: listing.id,
          make: listing.make,
          model: listing.model,
          year: listing.year,
          mileageKm: listing.mileage_km,
          priceCzk: listing.price_czk,
        },
      ]),
    ]);

  const priceEvaluation = priceEvaluations.get(listing.id);
  const history = summarizeListingHistory(
    listing.first_seen,
    (priceHistory ?? []).map((p) => ({ priceCzk: p.price_czk, priceOrig: p.price_orig, seenAt: p.seen_at })),
    listing.currency_orig
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <BackButton />
      <div className="card">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ListingGallery images={listing.image_urls ?? []} title={listing.title} />
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="badge inline-flex bg-gray-100 text-gray-600">{listing.source}</span>
              <div className="flex items-center gap-1.5">
                <FavoriteButton listingId={listing.id} initialFavorite={!!favoriteRow} />
                <CompareToggle listingId={listing.id} />
              </div>
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{listing.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-2xl font-bold text-brand-700">{formatCzk(listing.price_czk)}</span>
              {priceEvaluation && <PriceBadge evaluation={priceEvaluation} showCount />}
            </div>
            <ListingHistoryLine history={history} className="mt-1.5 text-xs text-gray-500" />

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-gray-600">
              <Field label="Rok" value={listing.year?.toString()} />
              <Field label="Nájezd" value={listing.mileage_km != null ? formatKm(listing.mileage_km) : undefined} />
              <Field label="Palivo" value={listing.fuel ? FUEL_LABELS[listing.fuel] : undefined} />
              <Field
                label="Převodovka"
                value={listing.transmission ? TRANSMISSION_LABELS[listing.transmission] : undefined}
              />
              <Field label="Karoserie" value={listing.body ? BODY_LABELS[listing.body] : undefined} />
              <Field label="Výkon" value={listing.power_kw ? `${listing.power_kw} kW` : undefined} />
              <Field label="Lokalita" value={listing.location ?? undefined} />
              <Field label="Naposledy vidět" value={formatDateTime(listing.last_seen)} />
            </dl>

            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer noopener"
              className="btn mt-5 w-full sm:w-auto"
            >
              Otevřít inzerát
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>

            <VinCheckLinks vin={listing.vin} />
          </div>
        </div>
      </div>

      {favoriteRow && (
        <div className="card">
          <h2 className="mb-3 section-title">Oblíbené</h2>
          <FavoriteStatusEditor listingId={listing.id} status={(favoriteRow.status as FavoriteStatus) ?? "none"} note={favoriteRow.note} />
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 section-title">Historie ceny</h2>
        <PriceHistoryChart
          points={priceHistory ?? []}
          currencyOrig={listing.currency_orig}
          currentPriceCzk={listing.price_czk}
        />
      </div>

      {(otherOffers ?? []).length > 0 && (
        <div className="card">
          <h2 className="mb-3 section-title">Další nabídky stejného vozu</h2>
          <ul className="divide-y divide-gray-100">
            {(otherOffers ?? []).map((o) => {
              const diff =
                o.price_czk != null && listing.price_czk != null ? o.price_czk - listing.price_czk : null;
              return (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="min-w-0 flex-1 truncate text-gray-700 hover:text-brand-700 hover:underline"
                  >
                    <span className="badge mr-1.5 bg-gray-100 text-gray-600">{o.source}</span>
                    {o.title}
                    {!o.is_active && <span className="ml-1 text-gray-400">— neaktivní</span>}
                  </a>
                  <span className="flex-shrink-0 text-right">
                    <span className="block font-semibold text-gray-900">{formatCzk(o.price_czk)}</span>
                    {diff != null && diff !== 0 && (
                      <span className={`block text-xs font-medium ${diff < 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {diff > 0 ? "+" : ""}
                        {formatCzk(diff)} oproti této
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-800">{value}</dd>
    </div>
  );
}
