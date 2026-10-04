import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ALL_FEATURE_GROUPS, resolveImageUrl, summarizeListingHistory } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { BackButton } from "@/components/back-button";
import { CarImage } from "@/components/car-image";
import { PriceBadge } from "@/components/price-badge";
import { ListingHistoryLine } from "@/components/listing-history-line";
import { fetchPriceEvaluations } from "@/lib/price-evaluation.server";
import {
  formatCzk,
  formatKm,
  DRIVE_LABELS,
  FUEL_LABELS,
  TRANSMISSION_LABELS,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const MAX_COMPARE = 3;
const FEATURE_LABEL_BY_ID = new Map(ALL_FEATURE_GROUPS.map((g) => [g.id, g.label]));

/**
 * /compare?ids=a,b,c — side-by-side comparison of 2–3 listings selected via
 * the "Porovnat" toggle on each card (see components/compare-toggle.tsx,
 * lib/compare-store.ts). The ids themselves live only in the URL (so the
 * page is shareable/bookmarkable); the client-side localStorage selection is
 * just what populates that URL from the sticky bottom bar.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids: idsParam } = await searchParams;
  const ids = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARE);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  if (ids.length < 2) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackButton fallbackHref="/results" />
        <div className="card text-sm text-gray-600">
          Vyberte alespoň 2 auta k porovnání (tlačítko „Porovnat" na kartě nabídky).
        </div>
      </div>
    );
  }

  const { data: listingsData } = await supabase.from("listings").select("*").in("id", ids);
  type ListingRow = NonNullable<typeof listingsData>[number];
  // Preserve the URL's order (not whatever order the DB returned) so the
  // columns match the order the user selected them in.
  const listings = ids
    .map((id) => listingsData?.find((l) => l.id === id))
    .filter((l): l is ListingRow => l != null);

  if (listings.length < 2) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackButton fallbackHref="/results" />
        <div className="card text-sm text-gray-600">
          Některá z vybraných nabídek už není dostupná. Vyberte prosím jiná auta k porovnání.
        </div>
      </div>
    );
  }

  const groupIds = [...new Set(listings.map((l) => l.group_id).filter((g): g is string => g != null))];

  const [priceEvaluations, { data: historyRows }, groupCountResult] = await Promise.all([
    fetchPriceEvaluations(
      supabase,
      listings.map((l) => ({
        id: l.id,
        make: l.make,
        model: l.model,
        year: l.year,
        mileageKm: l.mileage_km,
        priceCzk: l.price_czk,
      }))
    ),
    supabase
      .from("price_history")
      .select("listing_id, price_czk, seen_at")
      .in(
        "listing_id",
        listings.map((l) => l.id)
      ),
    groupIds.length > 0
      ? supabase.from("listings").select("id, group_id").in("group_id", groupIds).eq("is_active", true)
      : Promise.resolve({ data: [] as { id: string; group_id: string | null }[] }),
  ]);
  const groupCountRows = groupCountResult.data;

  const historyByListing = new Map<string, { price_czk: number | null; seen_at: string }[]>();
  for (const h of historyRows ?? []) {
    const list = historyByListing.get(h.listing_id) ?? [];
    list.push({ price_czk: h.price_czk, seen_at: h.seen_at });
    historyByListing.set(h.listing_id, list);
  }
  const groupOfferCount = new Map<string, number>();
  for (const row of groupCountRows ?? []) {
    if (!row.group_id) continue;
    groupOfferCount.set(row.group_id, (groupOfferCount.get(row.group_id) ?? 0) + 1);
  }

  const rows: { label: string; render: (l: (typeof listings)[number]) => React.ReactNode }[] = [
    {
      label: "Cena",
      render: (l) => (
        <div className="space-y-1">
          <div className="text-lg font-bold text-gray-900">{formatCzk(l.price_czk)}</div>
          {priceEvaluations.get(l.id) && <PriceBadge evaluation={priceEvaluations.get(l.id)!} showCount />}
        </div>
      ),
    },
    { label: "Rok", render: (l) => l.year ?? "neuvedeno" },
    { label: "Nájezd", render: (l) => formatKm(l.mileage_km) },
    { label: "Výkon", render: (l) => (l.power_kw ? `${l.power_kw} kW` : "neuvedeno") },
    { label: "Palivo", render: (l) => (l.fuel ? FUEL_LABELS[l.fuel] ?? l.fuel : "neuvedeno") },
    {
      label: "Převodovka",
      render: (l) => (l.transmission ? TRANSMISSION_LABELS[l.transmission] ?? l.transmission : "neuvedeno"),
    },
    { label: "Pohon", render: (l) => (l.drive ? DRIVE_LABELS[l.drive] ?? l.drive : "neuvedeno") },
    {
      label: "Výbava",
      render: (l) => {
        const ids = [...new Set([...(l.equipment ?? []), ...(l.detail_features ?? [])])];
        const labels = ids.map((id) => FEATURE_LABEL_BY_ID.get(id)).filter((x): x is string => Boolean(x));
        if (labels.length === 0) return <span className="text-gray-400">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <span key={label} className="badge bg-gray-100 text-gray-600">
                {label}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      label: "Inzerováno",
      render: (l) => {
        const history = summarizeListingHistory(
          l.first_seen,
          (historyByListing.get(l.id) ?? []).map((h) => ({ priceCzk: h.price_czk, seenAt: h.seen_at }))
        );
        return <ListingHistoryLine history={history} className="text-xs text-gray-600" />;
      },
    },
    {
      label: "Také na jiných webech",
      render: (l) => {
        const count = l.group_id ? (groupOfferCount.get(l.group_id) ?? 1) - 1 : 0;
        return count > 0 ? `${count}×` : <span className="text-gray-400">—</span>;
      },
    },
    {
      label: "Zdroj",
      render: (l) => (
        <a
          href={l.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-brand-600 hover:underline"
        >
          {l.source}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/results" />
      <h1 className="text-xl font-semibold text-gray-900">Porovnání vozů ({listings.length})</h1>

      {/* Horizontal scroll is contained to this wrapper only — the page
          itself never scrolls horizontally (min-w-0 on every ancestor,
          overflow-x-auto only here). */}
      <div className="min-w-0 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-28 flex-shrink-0 border-b border-gray-100 p-3 text-left text-xs font-semibold text-gray-400" />
              {listings.map((l) => {
                const img = resolveImageUrl(l.image_urls?.[0], "card");
                return (
                  <th key={l.id} className="min-w-[180px] border-b border-gray-100 p-3 text-left align-top">
                    <Link href={`/listing/${l.id}`} className="block">
                      <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-gray-100">
                        <CarImage src={img} alt={l.title} className="h-full w-full object-cover" />
                      </div>
                      <div className="mt-1.5 line-clamp-2 text-xs font-semibold text-gray-900 hover:text-brand-700">
                        {l.title}
                      </div>
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-gray-50 last:border-0">
                <th className="w-28 flex-shrink-0 p-3 text-left text-xs font-medium text-gray-500">{row.label}</th>
                {listings.map((l) => (
                  <td key={l.id} className="min-w-[180px] p-3 align-top text-gray-700">
                    {row.render(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
