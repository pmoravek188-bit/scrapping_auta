/**
 * Filters a listing's raw `price_history` rows down to genuine, seller-side
 * price changes, dropping anything that's only an artifact of the daily
 * EUR/CZK conversion.
 *
 * Why this exists (verified in production data): for EUR-priced sources
 * (autoscout24, carvago, autobazar — `listings.currency_orig = 'EUR'`), the
 * runner re-converts `price_orig` (EUR) to `price_czk` with THAT RUN's
 * EUR/CZK rate every time it upserts the listing (see runner.ts /
 * exchange-rate.ts). Even when the seller never touched the price, the CZK
 * figure drifts a little every run purely from the rate moving — which used
 * to write a brand new `price_history` row and get counted as a "price
 * drop". Measured in prod: autoscout24 had 6,014 `price_history` changes, of
 * which 5,645 (94%) were <= 3,000 Kc; carvago 2,544, of which 2,375 (93%)
 * were <= 3,000 Kc. Meanwhile genuine seller changes (on CZK-native sources,
 * immune to this at all, and the real moves mixed into the EUR sources
 * above) average 25,000-31,000 Kc — 8-10x bigger. A 3,000 Kc swing on a
 * typical EUR-priced car (think 500,000-800,000 Kc) is roughly 0.4-0.6% of
 * its price, so a 2.5% relative threshold sits comfortably above all the
 * observed noise and comfortably below every observed real change, with
 * margin on both sides.
 *
 * Two eras of data feed this:
 *   - Going forward, every `price_history` row also carries `price_orig` /
 *     `currency_orig` (see the `price_history_orig`-adding migration and
 *     runner.ts's insert) — comparing THOSE directly is exact, immune to FX
 *     entirely, no threshold needed.
 *   - Rows written before that migration have `price_orig: null` (legacy) —
 *     for those, the only signal available is the CZK amount, so a
 *     non-CZK-sourced listing falls back to the 2.5% tolerance above.
 *     CZK-native sources never had this problem (no conversion happens), so
 *     their legacy rows are compared exactly regardless.
 */

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** One `price_history` row as seen by `realPriceChanges` — a subset of the
 * table's columns (CZK snapshot +, from the migration onward, the original
 * currency amount at the time it was recorded). */
export interface PriceHistoryEntry {
  priceCzk: number | null;
  /** Original-currency amount at the time this row was written. `null` for
   * rows recorded before that column existed (see module doc comment). */
  priceOrig?: number | null;
  seenAt: string | Date;
}

/** A kept ("real") point in the collapsed series. */
export interface RealPricePoint {
  seenAt: string | Date;
  priceCzk: number;
  priceOrig: number | null;
}

/** Relative tolerance (of the previous kept point's CZK price) below which a
 * legacy, `price_orig`-less step is treated as FX noise rather than a real
 * change — see module doc comment for how this was picked from prod data. */
export const FX_NOISE_THRESHOLD_RATIO = 0.025;

/** A seller-set original price is never fractional below a cent/haléř in
 * practice; this just guards the exact-equality check against float noise. */
const ORIG_PRICE_EPSILON = 0.01;

/**
 * Collapses `history` (any order, any mix of legacy/new rows) into
 * chronologically-ordered "real" points — one per genuine seller-side price
 * change, plus the first point as a baseline. Rows with `priceCzk == null`
 * are dropped (nothing to compare). The LAST returned point's `priceCzk`
 * always reflects the most recently seen CZK value, even when that value's
 * latest-known-vs-baseline move was pure FX noise (so e.g. a chart's final
 * point / "current price" doesn't lag behind today's real CZK figure) — it
 * just doesn't introduce an extra *step* for that noise.
 *
 * @param history  The listing's `price_history` rows.
 * @param currencyOrig  The listing's `currency_orig` (`listings.currency_orig`
 *   — e.g. "CZK", "EUR"). Determines whether the FX-noise fallback applies at
 *   all: a CZK-native listing's CZK figure never moves except on a real
 *   price change, so every row is compared exactly regardless of whether it
 *   carries `priceOrig`.
 */
export function realPriceChanges(
  history: PriceHistoryEntry[],
  currencyOrig: string
): RealPricePoint[] {
  const sorted = history
    .filter((h): h is PriceHistoryEntry & { priceCzk: number } => h.priceCzk != null)
    .slice()
    .sort((a, b) => toTime(a.seenAt) - toTime(b.seenAt));
  if (sorted.length === 0) return [];

  const isCzkSource = currencyOrig.toUpperCase() === "CZK";

  const result: RealPricePoint[] = [
    {
      seenAt: sorted[0]!.seenAt,
      priceCzk: sorted[0]!.priceCzk,
      priceOrig: sorted[0]!.priceOrig ?? null,
    },
  ];

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]!;
    const last = result[result.length - 1]!;
    const currOrig = curr.priceOrig ?? null;
    let isReal: boolean;

    if (isCzkSource) {
      // No conversion ever happens for a CZK-native source — any change in
      // the CZK figure is a real, seller-side change.
      isReal = curr.priceCzk !== last.priceCzk;
    } else if (currOrig != null && last.priceOrig != null) {
      // Both sides have a trustworthy original-currency amount — compare
      // THAT directly. Exact, immune to FX entirely.
      isReal = Math.abs(currOrig - last.priceOrig) > ORIG_PRICE_EPSILON;
    } else if (currOrig != null && last.priceOrig == null) {
      // First row with a trustworthy original price after only-legacy rows
      // before it: nothing reliable to diff it against yet, so it becomes
      // the new baseline rather than being counted as a change either way.
      isReal = false;
    } else {
      // Legacy rows on both sides (no price_orig recorded for either) — the
      // only signal is the CZK amount, which moves every run purely from
      // the EUR/CZK rate on a non-CZK source. Collapse anything within
      // FX_NOISE_THRESHOLD_RATIO of the last kept point as noise.
      const base = last.priceCzk;
      const ratio = base !== 0 ? Math.abs(curr.priceCzk - base) / base : 1;
      isReal = ratio > FX_NOISE_THRESHOLD_RATIO;
    }

    if (isReal) {
      result.push({ seenAt: curr.seenAt, priceCzk: curr.priceCzk, priceOrig: currOrig });
    } else {
      // Slide the current point's CZK value (and, if we just got one, its
      // original price) forward without adding a new step.
      result[result.length - 1] = {
        seenAt: curr.seenAt,
        priceCzk: curr.priceCzk,
        priceOrig: currOrig ?? last.priceOrig,
      };
    }
  }

  return result;
}
