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

/** The criteria `explainMatch`/`matchesSearch` can reject a listing on. Kept
 * as plain strings (rather than an enum) so the audit script (see
 * `scripts/audit.ts`) can tally rejection reasons by name without importing
 * anything beyond this type. */
export type MatchFailureReason =
  | "make"
  | "model"
  | "year"
  | "price"
  | "mileage"
  | "fuel"
  | "transmission"
  | "body"
  | "power"
  | "drive"
  | "features"
  | "keywords"
  | "excludeKeywords"
  | "sources";

/**
 * Returns the first criterion on which `listing` fails to satisfy `query`,
 * or `null` if it's a full match. Checks run in a fixed, documented order so
 * "first failing reason" is deterministic and meaningful for debugging/audit
 * purposes (see `scripts/audit.ts`) — it is NOT necessarily "the only thing
 * wrong with this listing", just the first thing checked.
 */
export function explainMatch(listing: Listing, query: SearchQuery): MatchFailureReason | null {
  // Saved searches can carry raw, un-normalized user input (e.g. "ford "
  // with trailing whitespace) — normalize both sides the same way listings
  // themselves are normalized, so the comparison is apples-to-apples.
  const queryMake = normalizeMake(query.make);
  const queryModel = normalizeModel(query.model, queryMake ?? query.make);

  if (queryMake && listing.make !== queryMake) return "make";
  if (queryModel) {
    const titleHaystack = `${listing.title} ${listing.variant ?? ""}`;
    if (!modelMatches(listing.model, queryModel, titleHaystack)) return "model";
  }

  if (query.yearFrom != null && (listing.year == null || listing.year < query.yearFrom)) {
    return "year";
  }
  if (query.yearTo != null && (listing.year == null || listing.year > query.yearTo)) {
    return "year";
  }

  if (
    query.priceFrom != null &&
    (listing.priceCzk == null || listing.priceCzk < query.priceFrom)
  ) {
    return "price";
  }
  if (query.priceTo != null && (listing.priceCzk == null || listing.priceCzk > query.priceTo)) {
    return "price";
  }

  if (
    query.mileageMax != null &&
    (listing.mileageKm == null || listing.mileageKm > query.mileageMax)
  ) {
    return "mileage";
  }

  // fuel/transmission/body/power/drive are frequently absent from a source's
  // list page (e.g. sauto's search API never returns engine power) — treat a
  // null listing value as "unknown", not a mismatch, so real matches aren't
  // silently dropped just because one source can't supply that field. Only
  // reject when the listing DOES state a value and it disagrees with the
  // query. (year/price/mileage stay strict: those are numeric filters the
  // user set deliberately, and every source does supply them.)
  if (query.fuel && query.fuel.length > 0 && listing.fuel != null) {
    if (!query.fuel.includes(listing.fuel)) return "fuel";
  }

  if (query.transmission && listing.transmission != null && listing.transmission !== query.transmission) {
    return "transmission";
  }

  if (query.body && query.body.length > 0 && listing.body != null) {
    if (!query.body.includes(listing.body)) return "body";
  }

  if (query.powerMinKw != null && listing.powerKw != null && listing.powerKw < query.powerMinKw) {
    return "power";
  }

  // Drive type (AWD/FWD/RWD): same leniency policy as fuel/transmission/body/
  // power above. A source frequently doesn't expose drive type at all (it's
  // often only inferable from trim text like "xDrive"/"4Matic"/"quattro"),
  // so treating an unknown listing.drive as a non-match would silently drop
  // plenty of real AWD cars just because this particular source/listing
  // didn't state it — worse than occasionally showing an unconfirmed one.
  // Only reject when the listing DOES state a drive type and it disagrees.
  if (query.drive && query.drive.length > 0 && listing.drive != null) {
    if (!query.drive.includes(listing.drive)) return "drive";
  }

  // Equipment/version chips ("Výbava"/"Verze"): every ticked feature must be
  // detectable in the listing's title/variant/equipment text.
  if (query.features && query.features.length > 0) {
    const featureHaystack = `${listing.title} ${listing.variant ?? ""} ${(listing.equipment ?? []).join(" ")}`;
    if (!hasAllFeatures(featureHaystack, query.features, listing.detailFeatures)) return "features";
  }

  const haystack = `${listing.title} ${listing.variant ?? ""}`;
  if (query.keywords && query.keywords.length > 0) {
    const ok = query.keywords.some((kw) => includesToken(haystack, kw));
    if (!ok) return "keywords";
  }
  if (query.excludeKeywords && query.excludeKeywords.length > 0) {
    const bad = query.excludeKeywords.some((kw) => includesToken(haystack, kw));
    if (bad) return "excludeKeywords";
  }

  if (query.sources && query.sources.length > 0) {
    if (!query.sources.includes(listing.source)) return "sources";
  }

  return null;
}

/** Returns true if a normalized Listing satisfies a saved SearchQuery. */
export function matchesSearch(listing: Listing, query: SearchQuery): boolean {
  return explainMatch(listing, query) == null;
}

/**
 * True if `listing` fails `query` on "features" ALONE — i.e. it would be a
 * full match if the query's feature/version chips were satisfied. Used by
 * the scraper runner (see packages/scrapers/src/runner.ts) to decide which
 * near-match listings are worth an extra detail-page fetch: a listing that
 * already fails on e.g. year/price has no chance of matching no matter what
 * its detail page says, so it's not worth spending a fetch on.
 */
export function isFeatureOnlyMismatch(listing: Listing, query: SearchQuery): boolean {
  if (!query.features || query.features.length === 0) return false;
  if (explainMatch(listing, query) !== "features") return false;
  return explainMatch(listing, { ...query, features: [] }) == null;
}
