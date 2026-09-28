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

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Historie ceny">
      <path d={path} fill="none" stroke="#0a7d3b" strokeWidth={2} />
      {points2d.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#0a7d3b">
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
