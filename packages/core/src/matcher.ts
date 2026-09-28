import { normalizeMake, normalizeModel } from "./make-model.js";
import { hasAllFeatures } from "./features.js";
import { includesPhrase } from "./text-match.js";
import type { Listing, SearchQuery } from "./schemas.js";

/** Whole-token match (see `text-match.ts`): "havarovaná" never matches
 * "nehavarovaná", "4x4" never matches "4x40" — a shared prefix/suffix isn't
 * the same word the user typed. */
function includesToken(haystack: string, needle: string): boolean {
  return includesPhrase(haystack, needle);
}

/**
 * True if `listingModel` satisfies a query for `queryModel`, tolerating:
 * - an exact slug match ("octavia" === "octavia")
 * - the listing being a more specific variant of the query ("octavia-combi"
 *   starts with "octavia-", e.g. a body/trim suffix the source appends)
 * - a null listing.model, by falling back to a substring check against the
 *   listing's title/variant text (covers sources that don't expose model as
 *   a separate field and whose title-based inference missed/under-guessed it)
 */
function modelMatches(listingModel: string | null, queryModel: string, titleHaystack: string): boolean {
  if (listingModel != null) {
    return listingModel === queryModel || listingModel.startsWith(`${queryModel}-`);
  }
  return includesToken(titleHaystack, queryModel.replace(/-/g, " "));
}

/** Returns true if a normalized Listing satisfies a saved SearchQuery. */
export function matchesSearch(listing: Listing, query: SearchQuery): boolean {
  // Saved searches can carry raw, un-normalized user input (e.g. "ford "
  // with trailing whitespace) — normalize both sides the same way listings
  // themselves are normalized, so the comparison is apples-to-apples.
  const queryMake = normalizeMake(query.make);
  const queryModel = normalizeModel(query.model);

  if (queryMake && listing.make !== queryMake) return false;
  if (queryModel) {
    const titleHaystack = `${listing.title} ${listing.variant ?? ""}`;
    if (!modelMatches(listing.model, queryModel, titleHaystack)) return false;
  }

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

  // fuel/transmission/body/power are frequently absent from a source's list
  // page (e.g. sauto's search API never returns engine power) — treat a
  // null listing value as "unknown", not a mismatch, so real matches aren't
  // silently dropped just because one source can't supply that field. Only
  // reject when the listing DOES state a value and it disagrees with the
  // query. (year/price/mileage stay strict: those are numeric filters the
  // user set deliberately, and every source does supply them.)
  if (query.fuel && query.fuel.length > 0 && listing.fuel != null) {
    if (!query.fuel.includes(listing.fuel)) return false;
  }

  if (query.transmission && listing.transmission != null && listing.transmission !== query.transmission) {
    return false;
  }

  if (query.body && query.body.length > 0 && listing.body != null) {
    if (!query.body.includes(listing.body)) return false;
  }

  if (query.powerMinKw != null && listing.powerKw != null && listing.powerKw < query.powerMinKw) {
    return false;
  }

  // Drive type (AWD/FWD/RWD): unlike fuel/transmission/body/power above, a
  // ticked drive filter is NOT lenient on null — the user explicitly wants
  // certainty (e.g. "only show me confirmed 4x4s"), so an un-inferred
  // listing.drive is treated as a non-match rather than "maybe".
  if (query.drive && query.drive.length > 0) {
    if (!listing.drive || !query.drive.includes(listing.drive)) return false;
  }

  // Equipment/version chips ("Výbava"/"Verze"): every ticked feature must be
  // detectable in the listing's title/variant/equipment text.
  if (query.features && query.features.length > 0) {
    const featureHaystack = `${listing.title} ${listing.variant ?? ""} ${(listing.equipment ?? []).join(" ")}`;
    if (!hasAllFeatures(featureHaystack, query.features)) return false;
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
