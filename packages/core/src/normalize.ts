import { convertToCzk, FALLBACK_EUR_CZK } from "./currency.js";
import { parseBodyType, parseFuelType, parseTransmissionType } from "./enums.js";
import { normalizeMake, normalizeModel } from "./make-model.js";
import { computeFingerprint } from "./fingerprint.js";
import type { Listing, RawListing } from "./schemas.js";

export interface NormalizeOptions {
  source: string;
  eurCzkRate?: number;
}

/** Turns a loosely-typed RawListing scraped from a source into a canonical Listing. */
export function normalizeListing(raw: RawListing, opts: NormalizeOptions): Listing {
  const make = normalizeMake(raw.make ?? null);
  const model = normalizeModel(raw.model ?? null);
  const currency = (raw.currency ?? "CZK").toUpperCase();
  const priceOrig = raw.price ?? null;
  const priceCzk =
    priceOrig != null
      ? convertToCzk(priceOrig, currency, opts.eurCzkRate ?? FALLBACK_EUR_CZK)
      : null;

  const listing: Omit<Listing, "fingerprint"> = {
    source: opts.source,
    sourceId: raw.sourceId,
    url: raw.url,
    title: raw.title || [raw.make, raw.model, raw.variant].filter(Boolean).join(" "),
    make,
    model,
    variant: raw.variant ?? null,
    year: raw.year ?? null,
    mileageKm: raw.mileageKm ?? null,
    priceCzk,
    priceOrig,
    currencyOrig: currency,
    fuel: parseFuelType(raw.fuel ?? null),
    transmission: parseTransmissionType(raw.transmission ?? null),
    powerKw: raw.powerKw ?? null,
    body: parseBodyType(raw.body ?? null),
    color: raw.color ?? null,
    location: raw.location ?? null,
    country: raw.country ?? "CZ",
    sellerType:
      raw.sellerType === "private" || raw.sellerType === "dealer" ? raw.sellerType : "unknown",
    vin: raw.vin ?? null,
    imageUrls: raw.imageUrls ?? [],
  };

  return {
    ...listing,
    fingerprint: computeFingerprint(listing),
  };
}
