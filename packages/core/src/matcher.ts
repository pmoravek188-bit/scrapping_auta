import { normalizeEnumToken } from "./enums.js";
import type { Listing, SearchQuery } from "./schemas.js";

function includesToken(haystack: string, needle: string): boolean {
  return normalizeEnumToken(haystack).includes(normalizeEnumToken(needle));
}

/** Returns true if a normalized Listing satisfies a saved SearchQuery. */
export function matchesSearch(listing: Listing, query: SearchQuery): boolean {
  if (query.make && listing.make !== query.make) return false;
  if (query.model && listing.model !== query.model) return false;

  if (query.yearFrom != null && (listing.year == null || listing.year < query.yearFrom)) {
    return false;
  }
  if (query.yearTo != null && (listing.year == null || listing.year > query.yearTo)) {
    return false;
  }

  if (
    query.priceFrom != null &&
    (listing.priceCzk == null || listing.priceCzk < query.priceFrom)
  ) {
    return false;
  }
  if (query.priceTo != null && (listing.priceCzk == null || listing.priceCzk > query.priceTo)) {
    return false;
  }

  if (
    query.mileageMax != null &&
    (listing.mileageKm == null || listing.mileageKm > query.mileageMax)
  ) {
    return false;
  }

  if (query.fuel && query.fuel.length > 0) {
    if (!listing.fuel || !query.fuel.includes(listing.fuel)) return false;
  }

  if (query.transmission && listing.transmission !== query.transmission) return false;

  if (query.body && query.body.length > 0) {
    if (!listing.body || !query.body.includes(listing.body)) return false;
  }

  if (
    query.powerMinKw != null &&
    (listing.powerKw == null || listing.powerKw < query.powerMinKw)
  ) {
    return false;
  }

  const haystack = `${listing.title} ${listing.variant ?? ""}`;
  if (query.keywords && query.keywords.length > 0) {
    const ok = query.keywords.some((kw) => includesToken(haystack, kw));
    if (!ok) return false;
  }
  if (query.excludeKeywords && query.excludeKeywords.length > 0) {
    const bad = query.excludeKeywords.some((kw) => includesToken(haystack, kw));
    if (bad) return false;
  }

  if (query.sources && query.sources.length > 0) {
    if (!query.sources.includes(listing.source)) return false;
  }

  return true;
}
