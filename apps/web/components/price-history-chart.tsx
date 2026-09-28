import { formatCzk, formatDate } from "@/lib/format";

export interface PricePoint {
  price_czk: number | null;
  seen_at: string;
}

/** Simple inline-SVG line chart of price over time — no charting library needed. */
export function PriceHistoryChart({ points }: { points: PricePoint[] }) {
  const valid = points.filter((p) => p.price_czk != null) as { price_czk: number; seen_at: string }[];
  if (valid.length < 2) {
    return <p className="text-sm text-gray-500">Zatím nemáme dost dat pro graf ceny.</p>;
  }

  const width = 560;
  const height = 160;
  const padding = 24;
  const prices = valid.map((p) => p.price_czk);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const points2d = valid.map((p, i) => {
    const x = padding + (i / (valid.length - 1)) * (width - padding * 2);
    const y = height - padding - ((p.price_czk - min) / range) * (height - padding * 2);
    return { x, y, ...p };
  });

  const path = points2d.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${points2d[points2d.length - 1]!.x.toFixed(1)},${height - padding} L${points2d[0]!.x.toFixed(1)},${height - padding} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Historie ceny">
      <defs>
        <linearGradient id="price-history-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f6cf5" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2f6cf5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#price-history-fill)" stroke="none" />
      <path d={path} fill="none" stroke="#2f6cf5" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points2d.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke="#2f6cf5" strokeWidth={2}>
          <title>
            {formatCzk(p.price_czk)} — {formatDate(p.seen_at)}
          </title>
        </circle>
      ))}
      <text x={padding} y={14} fontSize={11} fill="#6b7280">
        {formatCzk(max)}
      </text>
      <text x={padding} y={height - 8} fontSize={11} fill="#6b7280">
        {formatCzk(min)}
      </text>
    </svg>
  );
}
