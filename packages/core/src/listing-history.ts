/**
 * Listing history summary ("inzerováno 45 dní", "zlevněno 2× (−35 000 Kč)")
 * shown on cards/detail — pure computation over `first_seen` and the
 * listing's `price_history` rows, no DB/IO of its own.
 */

export interface HistoryPricePoint {
  priceCzk: number | null;
  seenAt: string | Date;
}

export interface ListingHistorySummary {
  /** Whole days since `firstSeen`, floored, never negative. */
  daysListed: number;
  /** Number of times the price went down (strictly) between two consecutive
   * known-price points, in chronological order. */
  priceDropCount: number;
  /** Sum of every individual decrease (CZK, always >= 0) — NOT simply
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
 * @param now  Injectable for tests; defaults to the real current time.
 */
export function summarizeListingHistory(
  firstSeen: string | Date,
  priceHistory: HistoryPricePoint[],
  now: string | Date = new Date()
): ListingHistorySummary {
  const firstSeenMs = toTime(firstSeen);
  const nowMs = toTime(now);
  const daysListed = Math.max(0, Math.floor((nowMs - firstSeenMs) / (24 * 60 * 60 * 1000)));

  const prices = priceHistory
    .filter((p): p is { priceCzk: number; seenAt: string | Date } => p.priceCzk != null)
    .sort((a, b) => toTime(a.seenAt) - toTime(b.seenAt))
    .map((p) => p.priceCzk);

  let priceDropCount = 0;
  let totalDropCzk = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i - 1]! - prices[i]!;
    if (diff > 0) {
      priceDropCount++;
      totalDropCzk += diff;
    }
  }

  return { daysListed, priceDropCount, totalDropCzk };
}
