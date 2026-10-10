import { realPriceChanges } from "@scrapping-auta/core";
import { formatCzk, formatDate } from "@/lib/format";

export interface PricePoint {
  price_czk: number | null;
  /** Original-currency amount at the time this row was recorded — null for
   * rows written before that column existed (see
   * packages/core/src/price-changes.ts). Optional so existing callers that
   * only ever selected price_czk/seen_at keep compiling. */
  price_orig?: number | null;
  seen_at: string;
}

/**
 * Inline-SVG STEP chart of REAL price changes over time (no FX-conversion
 * noise — see packages/core/src/price-changes.ts's `realPriceChanges`, which
 * this delegates to). A flat line that only steps at a genuine seller price
 * change, rather than wobbling with every EUR/CZK rate movement.
 *
 * `currencyOrig` is the listing's `currency_orig` (defaults to "CZK" — no FX
 * noise possible). `currentPriceCzk`, if given and it differs from the last
 * real point, is drawn as a dashed continuation to "now" — keeping today's
 * live CZK figure visible even when it hasn't (yet) diverged enough from the
 * last real point to count as its own step.
 */
export function PriceHistoryChart({
  points,
  currencyOrig = "CZK",
  currentPriceCzk,
}: {
  points: PricePoint[];
  currencyOrig?: string;
  currentPriceCzk?: number | null;
}) {
  const real = realPriceChanges(
    points.map((p) => ({ priceCzk: p.price_czk, priceOrig: p.price_orig ?? null, seenAt: p.seen_at })),
    currencyOrig
  );
  const valid = real.map((p) => ({
    price_czk: p.priceCzk,
    seen_at: typeof p.seenAt === "string" ? p.seenAt : p.seenAt.toISOString(),
  }));

  if (valid.length < 2) {
    return <p className="text-sm text-gray-500">Zatím nemáme dost dat pro graf ceny.</p>;
  }

  const lastReal = valid[valid.length - 1]!;
  const showCurrent = currentPriceCzk != null && currentPriceCzk !== lastReal.price_czk;

  const width = 560;
  const height = 160;
  const padding = 24;
  const allPrices = [...valid.map((p) => p.price_czk), ...(showCurrent ? [currentPriceCzk!] : [])];
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = max - min || 1;
  // One extra x-slot reserved for "now" when shown, so the dashed segment has
  // somewhere to go that isn't on top of the last real point.
  const xSlots = valid.length - 1 + (showCurrent ? 1 : 0) || 1;

  const points2d = valid.map((p, i) => {
    const x = padding + (i / xSlots) * (width - padding * 2);
    const y = height - padding - ((p.price_czk - min) / range) * (height - padding * 2);
    return { x, y, ...p };
  });

  // Step-after path: hold flat at the previous price until the new point's
  // x, then step vertically — a flat line with steps, not a diagonal slope,
  // so the chart reads as "price held at X, then changed", not a smooth (and
  // misleading) ramp between two snapshots.
  const path = points2d
    .map((p, i) => {
      if (i === 0) return `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      const prev = points2d[i - 1]!;
      return `L${p.x.toFixed(1)},${prev.y.toFixed(1)} L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");
  const lastPoint = points2d[points2d.length - 1]!;
  const areaPath = `${path} L${lastPoint.x.toFixed(1)},${height - padding} L${points2d[0]!.x.toFixed(1)},${height - padding} Z`;

  const nowX = padding + (xSlots / xSlots) * (width - padding * 2);
  const nowY = showCurrent
    ? height - padding - ((currentPriceCzk! - min) / range) * (height - padding * 2)
    : null;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Historie ceny">
        <defs>
          <linearGradient id="price-history-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f6cf5" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2f6cf5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#price-history-fill)" stroke="none" />
        <path d={path} fill="none" stroke="#2f6cf5" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {showCurrent && nowY != null && (
          <line
            x1={lastPoint.x}
            y1={lastPoint.y}
            x2={nowX}
            y2={nowY}
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        )}
        {points2d.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke="#2f6cf5" strokeWidth={2}>
            <title>
              {formatCzk(p.price_czk)} — {formatDate(p.seen_at)}
            </title>
          </circle>
        ))}
        {showCurrent && nowY != null && (
          <circle cx={nowX} cy={nowY} r={3.5} fill="#fff" stroke="#9ca3af" strokeWidth={2} strokeDasharray="2 2">
            <title>{formatCzk(currentPriceCzk)} — nyní</title>
          </circle>
        )}
        <text x={padding} y={14} fontSize={11} fill="#6b7280">
          {formatCzk(max)}
        </text>
        <text x={padding} y={height - 8} fontSize={11} fill="#6b7280">
          {formatCzk(min)}
        </text>
      </svg>
      {showCurrent && (
        <p className="mt-1 text-xs text-gray-400">
          Aktuálně (vč. kurzového pohybu): {formatCzk(currentPriceCzk)}
        </p>
      )}
    </div>
  );
}
