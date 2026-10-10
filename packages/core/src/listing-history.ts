/**
 * Listing history summary ("inzerováno 45 dní", "zlevněno 2× (−35 000 Kč)")
 * shown on cards/detail — pure computation over `first_seen` and the
 * listing's `price_history` rows, no DB/IO of its own.
 *
 * The drop count/total only ever counts REAL (seller-side) price changes —
 * see price-changes.ts's `realPriceChanges`, which this delegates to for
 * filtering out EUR/CZK-conversion noise on non-CZK-priced sources.
 */
import { realPriceChanges, type PriceHistoryEntry } from "./price-changes.js";

export type HistoryPricePoint = PriceHistoryEntry;

export interface ListingHistorySummary {
  /** Whole days since `firstSeen`, floored, never negative. */
  daysListed: number;
  /** Number of times the (real, FX-noise-filtered) price went down between
   * two consecutive real price points, in chronological order. */
  priceDropCount: number;
  /** Sum of every individual real decrease (CZK, always >= 0) — NOT simply
   * first-price-minus-last-price, so a drop that's later partly offset by a
   * price increase still counts the original drop(s) in full. */
  totalDropCzk: number;
}

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * @param firstSeen  `listings.first_seen` (or the earliest known price_history
 *   point, if that predates it for some reason).
 * @param priceHistory  `price_history` rows for the listing, any order (this
 *   sorts them itself).
 * @param currencyOrig  The listing's `currency_orig` (`listings.currency_orig`)
 *   — needed to tell a real price change apart from EUR/CZK-conversion
 *   noise. Defaults to "CZK" (no FX noise possible) for callers that don't
 *   have it handy (e.g. a listing with no price history at all).
 * @param now  Injectable for tests; defaults to the real current time.
 */
export function summarizeListingHistory(
  firstSeen: string | Date,
  priceHistory: HistoryPricePoint[],
  currencyOrig: string = "CZK",
  now: string | Date = new Date()
): ListingHistorySummary {
  const firstSeenMs = toTime(firstSeen);
  const nowMs = toTime(now);
  const daysListed = Math.max(0, Math.floor((nowMs - firstSeenMs) / (24 * 60 * 60 * 1000)));

  const realPoints = realPriceChanges(priceHistory, currencyOrig);

  let priceDropCount = 0;
  let totalDropCzk = 0;
  for (let i = 1; i < realPoints.length; i++) {
    const diff = realPoints[i - 1]!.priceCzk - realPoints[i]!.priceCzk;
    if (diff > 0) {
      priceDropCount++;
      totalDropCzk += diff;
    }
  }

  return { daysListed, priceDropCount, totalDropCzk };
}
