import { convertToCzk, FALLBACK_EUR_CZK } from "./currency.js";
import { parseBodyType, parseDriveType, parseFuelType, parseTransmissionType } from "./enums.js";
import { normalizeMake, normalizeModel } from "./make-model.js";
import { inferMakeModel, inferDrive } from "./infer.js";
import { computeFingerprint } from "./fingerprint.js";
import type { Listing, RawListing } from "./schemas.js";

export interface NormalizeOptions {
  source: string;
  eurCzkRate?: number;
}

/** Turns a loosely-typed RawListing scraped from a source into a canonical Listing. */
export function normalizeListing(raw: RawListing, opts: NormalizeOptions): Listing {
  let make = normalizeMake(raw.make ?? null);
  let model = normalizeModel(raw.model ?? null);
  if (!make || !model) {
    // Some sources (bazos, autoesa, dasweltauto, ...) don't expose make/model
    // as separate fields; best-effort recover them from the free-text title.
    const titleText = raw.title || [raw.make, raw.model, raw.variant].filter(Boolean).join(" ");
    const inferred = inferMakeModel(titleText, make);
    if (!make) make = inferred.make;
    if (!model) model = inferred.model;
  }
  const currency = (raw.currency ?? "CZK").toUpperCase();
  const priceOrig = raw.price ?? null;
  const priceCzk =
    priceOrig != null
      ? convertToCzk(priceOrig, currency, opts.eurCzkRate ?? FALLBACK_EUR_CZK)
      : null;

  // Structured drive field first (e.g. carvago's DRIVE_4X4 catalog feature),
  // then best-effort inference from title+variant text (e.g. "... 4x4 L2").
  const driveText = `${raw.title ?? ""} ${raw.variant ?? ""}`;
  const drive = parseDriveType(raw.drive ?? null) ?? inferDrive(driveText);

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
    drive,
    equipment: raw.equipment ?? [],
  };

  return {
    ...listing,
    fingerprint: computeFingerprint(listing),
  };
}
