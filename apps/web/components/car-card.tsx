import Link from "next/link";
import { formatCzk, formatKm, FUEL_LABELS } from "@/lib/format";

export interface CarCardListing {
  id: string;
  title: string;
  url: string;
  source: string;
  price_czk: number | null;
  year: number | null;
  mileage_km: number | null;
  fuel: string | null;
  location: string | null;
  image_urls: string[];
  group_offer_count?: number;
}

export function CarCard({ listing }: { listing: CarCardListing }) {
  const img = listing.image_urls?.[0];
  return (
    <div className="card flex gap-3">
      <div className="h-20 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
        {img ? (
          <img src={img} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl">🚗</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={`/listing/${listing.id}`}
          className="line-clamp-2 text-sm font-semibold text-gray-900 hover:underline"
        >
          {listing.title}
        </Link>
        <div className="mt-1 text-xs text-gray-500">
          {[
            listing.year,
            listing.mileage_km != null ? formatKm(listing.mileage_km) : null,
            listing.fuel ? FUEL_LABELS[listing.fuel] : null,
            listing.location,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm font-bold text-brand-700">{formatCzk(listing.price_czk)}</span>
          <span className="text-xs text-gray-400">{listing.source}</span>
        </div>
        {listing.group_offer_count && listing.group_offer_count > 1 && (
          <div className="mt-1 text-xs font-medium text-brand-600">
            více nabídek ({listing.group_offer_count})
          </div>
        )}
      </div>
    </div>
  );
}
