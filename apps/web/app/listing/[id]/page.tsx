import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { PriceHistoryChart } from "@/components/price-history-chart";
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
    <div className="max-w-3xl space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-lg font-semibold">{listing.title}</h1>
          <span className="text-xl font-bold text-brand-700">{formatCzk(listing.price_czk)}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600 sm:grid-cols-3">
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
          <Field label="Zdroj" value={listing.source} />
          <Field label="Naposledy vidět" value={formatDateTime(listing.last_seen)} />
        </div>
        <a
          href={listing.url}
          target="_blank"
          rel="noreferrer noopener"
          className="btn mt-4 inline-block"
        >
          Zobrazit inzerát na {listing.source}
        </a>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Historie ceny</h2>
        <PriceHistoryChart points={priceHistory ?? []} />
      </div>

      {(otherOffers ?? []).length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Další nabídky stejného vozu</h2>
          <ul className="space-y-2">
            {(otherOffers ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between text-sm">
                <a href={o.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                  {o.title} ({o.source}){!o.is_active && " — neaktivní"}
                </a>
                <span className="font-medium">{formatCzk(o.price_czk)}</span>
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
      <span className="text-gray-400">{label}: </span>
      <span>{value}</span>
    </div>
  );
}
