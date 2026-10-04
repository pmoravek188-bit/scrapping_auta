/**
 * Price evaluation ("Výhodná cena" / "Cena odpovídá" / "Drahé" badges): for a
 * listing, compares its price against the median of comparable ACTIVE
 * listings — same make+model, year within ±1, mileage within ±30% or ±25,000
 * km (whichever window is wider), excluding the listing itself.
 *
 * Deliberately a plain median rather than a regression/linear adjustment:
 * with the comparable set already narrowed to near-identical year+mileage,
 * a linear mileage/year adjustment would add complexity for very little
 * accuracy gain, and a median is far more robust to the odd wildly
 * over/under-priced outlier (private seller typo, a dealer's "chci se zbavit
 * rychle" price, ...) than a mean would be.
 *
 * Callers are expected to fetch candidates cheaply: one DB query per distinct
 * (make, model) pair across the listings being displayed (see
 * apps/web/lib/price-evaluation.server.ts), then call `evaluatePrice` once
 * per listing against that shared candidate pool — `evaluatePrice` itself
 * does the per-listing year/mileage narrowing and exclusion, so it stays a
 * pure, easily testable function with no DB/IO of its own.
 */

/** Minimal shape of a candidate/target listing needed to evaluate price.
 * `id` is optional — only needed so `evaluatePrice` can exclude the target
 * listing itself from its own comparable pool when candidates includes it. */
export interface PriceEvaluationListing {
  id?: string;
  priceCzk: number | null;
  year: number | null;
  mileageKm: number | null;
}

export type PriceEvaluationLabel = "good" | "fair" | "expensive";

export interface PriceEvaluation {
  /** Median price (CZK) of the comparable set the target was judged against. */
  fairPriceCzk: number;
  /** (target.priceCzk - fairPriceCzk) / fairPriceCzk * 100 — negative means
   * cheaper than comparable cars, positive means more expensive. Not rounded;
   * callers round for display. */
  diffPct: number;
  label: PriceEvaluationLabel;
  /** How many comparable listings the median was computed from. */
  comparableCount: number;
}

/** At least this many comparables are required, else `evaluatePrice` returns
 * null (too few data points to say anything meaningful). */
export const MIN_COMPARABLES = 4;
const YEAR_TOLERANCE = 1;
const MILEAGE_PCT_TOLERANCE = 0.3;
const MILEAGE_ABS_TOLERANCE_KM = 25_000;
/** ≤ this = "Výhodná cena" (green); ≥ +GOOD..EXPENSIVE gap = "Cena odpovídá" (gray). */
const GOOD_THRESHOLD_PCT = -5;
/** ≥ this = "Drahé" (orange). */
const EXPENSIVE_THRESHOLD_PCT = 5;

/** True if `candidate` is close enough in year AND mileage to `target` to
 * count as a comparable. A null year/mileage on either side is treated as
 * "don't filter on this dimension" (too little data to narrow by it) rather
 * than an automatic exclusion. */
function isComparable(
  target: Pick<PriceEvaluationListing, "year" | "mileageKm">,
  candidate: Pick<PriceEvaluationListing, "year" | "mileageKm">
): boolean {
  if (target.year != null && candidate.year != null) {
    if (Math.abs(candidate.year - target.year) > YEAR_TOLERANCE) return false;
  }
  if (target.mileageKm != null && candidate.mileageKm != null) {
    const window = Math.max(target.mileageKm * MILEAGE_PCT_TOLERANCE, MILEAGE_ABS_TOLERANCE_KM);
    if (Math.abs(candidate.mileageKm - target.mileageKm) > window) return false;
  }
  return true;
}

/** Narrows `candidates` (already expected to be pre-filtered to the same
 * make+model and active) down to those comparable to `target` by year/mileage,
 * excluding the target itself (matched by `id` when both have one) and any
 * candidate with no price. */
export function selectComparables(
  target: PriceEvaluationListing,
  candidates: PriceEvaluationListing[]
): PriceEvaluationListing[] {
  return candidates.filter((c) => {
    if (c.priceCzk == null) return false;
    if (target.id != null && c.id != null && c.id === target.id) return false;
    return isComparable(target, c);
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Evaluates `target`'s price against `candidates` (same make+model, active —
 * the caller's responsibility; see module doc). Returns null when the target
 * has no price, or fewer than `MIN_COMPARABLES` candidates remain after
 * year/mileage narrowing.
 */
export function evaluatePrice(
  target: PriceEvaluationListing,
  candidates: PriceEvaluationListing[]
): PriceEvaluation | null {
  if (target.priceCzk == null) return null;
  const comparables = selectComparables(target, candidates);
  if (comparables.length < MIN_COMPARABLES) return null;

  const fairPriceCzk = median(comparables.map((c) => c.priceCzk!));
  if (fairPriceCzk <= 0) return null;
  const diffPct = ((target.priceCzk - fairPriceCzk) / fairPriceCzk) * 100;
  const label: PriceEvaluationLabel =
    diffPct <= GOOD_THRESHOLD_PCT ? "good" : diffPct >= EXPENSIVE_THRESHOLD_PCT ? "expensive" : "fair";

  return { fairPriceCzk, diffPct, label, comparableCount: comparables.length };
}
