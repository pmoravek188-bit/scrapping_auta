import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { PriceHistoryChart } from "@/components/price-history-chart";
import { ListingGallery } from "@/components/listing-gallery";
import { formatCzk, formatDateTime, formatKm, FUEL_LABELS, TRANSMISSION_LABELS, BODY_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: listing } = await supabase.from("listings").select("*").eq("id", id).maybeSingle();
  if (!listing) notFound();

  const [{ data: priceHistory }, { data: otherOffers }] = await Promise.all([
    supabase
      .from("price_history")
      .select("price_czk, seen_at")
      .eq("listing_id", id)
      .order("seen_at", { ascending: true }),
    listing.group_id
      ? supabase
          .from("listings")
          .select("id, source, title, url, price_czk, is_active")
          .eq("group_id", listing.group_id)
          .neq("id", id)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="card">
        <div className="grid gap-4 sm:grid-cols-2">
          <ListingGallery images={listing.image_urls ?? []} title={listing.title} />
          <div>
            <span className="badge mb-2 inline-flex bg-gray-100 text-gray-600">{listing.source}</span>
            <h1 className="text-lg font-semibold text-gray-900">{listing.title}</h1>
            <div className="mt-2 text-2xl font-bold text-brand-700">{formatCzk(listing.price_czk)}</div>

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
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 section-title">Historie ceny</h2>
        <PriceHistoryChart points={priceHistory ?? []} />
      </div>

      {(otherOffers ?? []).length > 0 && (
        <div className="card">
          <h2 className="mb-3 section-title">Další nabídky stejného vozu</h2>
          <ul className="divide-y divide-gray-100">
            {(otherOffers ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate text-gray-700 hover:text-brand-700 hover:underline"
                >
                  {o.title} <span className="text-gray-400">({o.source})</span>
                  {!o.is_active && <span className="ml-1 text-gray-400">— neaktivní</span>}
                </a>
                <span className="flex-shrink-0 font-semibold text-gray-900">{formatCzk(o.price_czk)}</span>
              </li>
            ))}
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
