import Link from "next/link";
import { Calendar, Gauge, MapPin, ImageOff, TrendingDown, Layers } from "lucide-react";
import clsx from "clsx";
import { formatCzk, formatKm, FUEL_LABELS, TRANSMISSION_LABELS } from "@/lib/format";
import { FUEL_ICONS } from "@/lib/icons";
import { FavoriteButton } from "@/components/favorite-button";

export interface CarCardListing {
  id: string;
  title: string;
  url: string;
  source: string;
  price_czk: number | null;
  year: number | null;
  mileage_km: number | null;
  fuel: string | null;
  transmission?: string | null;
  power_kw?: number | null;
  location: string | null;
  image_urls: string[];
  group_offer_count?: number;
  price_dropped?: boolean;
}

export function CarCard({
  listing,
  matchId,
  favorite,
  className,
}: {
  listing: CarCardListing;
  matchId?: string;
  favorite?: boolean;
  className?: string;
}) {
  const img = listing.image_urls?.[0];
  const FuelIcon = listing.fuel ? FUEL_ICONS[listing.fuel as keyof typeof FUEL_ICONS] : null;

  const specs = [
    listing.year ? { icon: Calendar, text: String(listing.year) } : null,
    listing.mileage_km != null ? { icon: Gauge, text: formatKm(listing.mileage_km) } : null,
    listing.fuel
      ? { icon: FuelIcon ?? undefined, text: FUEL_LABELS[listing.fuel] ?? listing.fuel }
      : null,
    listing.transmission
      ? { icon: undefined, text: TRANSMISSION_LABELS[listing.transmission] ?? listing.transmission }
      : null,
    listing.power_kw ? { icon: undefined, text: `${listing.power_kw} kW` } : null,
  ].filter(Boolean) as { icon?: typeof Calendar; text: string }[];

  return (
    <div
      className={clsx(
        "group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover",
        className
      )}
    >
      <Link href={`/listing/${listing.id}`} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100">
          {img ? (
            <img
              src={img}
              alt={listing.title}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">
              <ImageOff className="h-10 w-10" aria-hidden />
            </div>
          )}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {listing.group_offer_count && listing.group_offer_count > 1 && (
              <span className="badge bg-white/90 text-gray-700 shadow-sm">
                <Layers className="h-3 w-3" aria-hidden />
                více nabídek ({listing.group_offer_count})
              </span>
            )}
            {listing.price_dropped && (
              <span className="badge bg-emerald-600 text-white shadow-sm">
                <TrendingDown className="h-3 w-3" aria-hidden />
                zlevněno
              </span>
            )}
          </div>
          <span className="badge absolute right-2 top-2 bg-black/60 text-white backdrop-blur-sm">
            {listing.source}
          </span>
          {matchId && (
            <div className="absolute bottom-2 right-2">
              <FavoriteButton matchId={matchId} initialFavorite={!!favorite} />
            </div>
          )}
        </div>
      </Link>
      <div className="p-3">
        <Link href={`/listing/${listing.id}`} className="line-clamp-2 text-sm font-semibold text-gray-900 hover:text-brand-700">
          {listing.title}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-500">
          {specs.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {s.icon && <s.icon className="h-3.5 w-3.5" aria-hidden />}
              {s.text}
            </span>
          ))}
        </div>
        {listing.location && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400">
            <MapPin className="h-3 w-3" aria-hidden />
            {listing.location}
          </div>
        )}
        <div className="mt-2 text-lg font-bold text-gray-900">{formatCzk(listing.price_czk)}</div>
      </div>
    </div>
  );
}
