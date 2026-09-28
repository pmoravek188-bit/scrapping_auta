/**
 * Deduplication fingerprint used to group listings for the same physical car
 * across different sources into one `group_id`. VIN is authoritative when
 * present; otherwise we fall back to make+model+year+mileage(rounded to
 * 1000 km)+power.
 */
export interface FingerprintInput {
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  mileageKm?: number | null;
  powerKw?: number | null;
}

export function computeFingerprint(listing: FingerprintInput): string {
  if (listing.vin && listing.vin.trim().length >= 8) {
    return `vin:${listing.vin.trim().toUpperCase()}`;
  }
  const make = listing.make ?? "unknown";
  const model = listing.model ?? "unknown";
  const year = listing.year ?? "unknown";
  const mileageBucket =
    listing.mileageKm != null ? Math.round(listing.mileageKm / 1000) * 1000 : "unknown";
  const power = listing.powerKw ?? "unknown";
  return `mk:${make}|md:${model}|yr:${year}|mi:${mileageBucket}|pw:${power}`;
}
