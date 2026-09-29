import Link from "next/link";
import { Calendar, Gauge, MapPin, TrendingDown, Layers, Sparkles } from "lucide-react";
import clsx from "clsx";
import { resolveImageUrl } from "@scrapping-auta/core";
import { formatCzk, formatKm, FUEL_LABELS, TRANSMISSION_LABELS } from "@/lib/format";
import { FUEL_ICONS } from "@/lib/icons";
import { FavoriteButton } from "@/components/favorite-button";
import { HideButton } from "@/components/hide-button";
import { CarImage } from "@/components/car-image";

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
  drive?: string | null;
  group_offer_count?: number;
  price_dropped?: boolean;
  is_new?: boolean;
}

export function CarCard({
  listing,
  favorite,
  className,
  onHide,
  hideBusy,
}: {
  listing: CarCardListing;
  /** No longer used by CarCard itself (favourites are a standalone
   * `listing.id`-keyed toggle, see favorite-button.tsx) — kept optional on
   * this type only so existing callers that still pass it (for `onHide`'s
   * own `matches` row) don't need updating. */
  matchId?: string;
  favorite?: boolean;
  className?: string;
  /** Task E: "Skrýt nabídku" is now a small round icon button in the image's
   * top-right corner (next to the favourite button) instead of an
   * absolutely-positioned overlay at the bottom, which used to sit on top of
   * the price. Only rendered when the caller passes a handler (hiding needs
   * a `matches` row, which only exists in the "Moje hledání" scope). */
  onHide?: () => void;
  hideBusy?: boolean;
}) {
  const img = resolveImageUrl(listing.image_urls?.[0], "card");
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
          <CarImage
            src={img}
            alt={listing.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          {/* Badges: top-left, stacked/wrapped — never overlaps the icon
              buttons (top-right) or the source badge (bottom-left). */}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {listing.is_new && (
              <span className="badge bg-emerald-500 text-white shadow-sm">
                <Sparkles className="h-3 w-3" aria-hidden />
                NOVÉ
              </span>
            )}
            {listing.drive === "awd" && (
              <span className="badge bg-gray-900/85 text-white shadow-sm">4x4</span>
            )}
            {listing.group_offer_count && listing.group_offer_count > 1 && (
              <span className="badge bg-white/90 text-gray-700 shadow-sm">
                <Layers className="h-3 w-3" aria-hidden />
                více nabídek ({listing.group_offer_count})
              </span>
            )}
            {listing.price_dropped && (
              <span className="badge bg-amber-500 text-white shadow-sm">
                <TrendingDown className="h-3 w-3" aria-hidden />
                zlevněno
              </span>
            )}
          </div>

          {/* Source badge: bottom-left of the image (task E moved it away
              from top-right so it can't collide with the icon buttons). */}
          <span className="badge absolute bottom-2 left-2 bg-black/60 text-white backdrop-blur-sm">
            {listing.source}
          </span>

          {/* Icon buttons: top-right of the image, horizontal, small round
              buttons — kept well clear of the price/title text below.
              NOTE: no wrapping onClick here — this file (car-card.tsx) is
              rendered both as a genuine Server Component (app/page.tsx) and
              as a client-rendered component (results/result-row.tsx), and a
              Server Component's own JSX can never attach a raw DOM event
              handler. FavoriteButton/HideButton are real Client Components
              that each handle their own preventDefault+stopPropagation.
              The heart is a standalone per-user favourites-table toggle
              (see favorite-button.tsx), so — unlike "Skrýt nabídku", which
              needs a `matches` row — it's shown on every listing. */}
          <div className="absolute right-2 top-2 flex items-center gap-1.5">
            <FavoriteButton listingId={listing.id} initialFavorite={!!favorite} />
            {onHide && <HideButton onHide={onHide} busy={hideBusy} />}
          </div>
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
