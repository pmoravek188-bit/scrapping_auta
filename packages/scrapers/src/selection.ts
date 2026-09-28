import { matchesSearch, type Listing, type SearchQuery } from "@scrapping-auta/core";

/**
 * Keeps only the listings that satisfy at least one of the given saved
 * searches.
 *
 * Product decision: the database should hold only cars that match some
 * saved search, not everything the scraper happens to fetch (see README,
 * section "Co se ukládá do databáze"). The caller is responsible for
 * narrowing `searches` to the ones relevant to the listings' source (the
 * runner already knows which enabled searches use which source) — this
 * function itself is source-agnostic and just applies `matchesSearch`.
 *
 * If `searches` is empty, nothing is stored (an empty search set can never
 * match anything), which also naturally covers "no searches configured yet".
 */
export function selectListingsToStore(listings: Listing[], searches: SearchQuery[]): Listing[] {
  if (searches.length === 0) return [];
  return listings.filter((listing) => searches.some((query) => matchesSearch(listing, query)));
}
