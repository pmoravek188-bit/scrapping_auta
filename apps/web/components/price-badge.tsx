import clsx from "clsx";
import type { PriceEvaluation } from "@scrapping-auta/core";

const LABEL_CLASSES: Record<PriceEvaluation["label"], string> = {
  good: "bg-emerald-500 text-white",
  fair: "bg-gray-200 text-gray-700",
  expensive: "bg-orange-500 text-white",
};

function labelText(evaluation: PriceEvaluation): string {
  const pct = Math.round(evaluation.diffPct);
  if (evaluation.label === "good") return `Výhodná cena ${pct} %`;
  if (evaluation.label === "expensive") return `Drahé +${pct} %`;
  return "Cena odpovídá";
}

/**
 * Price-evaluation badge ("Výhodná cena −8 %" / "Cena odpovídá" / "Drahé
 * +12 %") — see packages/core/src/price-evaluation.ts for the underlying
 * comparison. `showCount` adds the comparable count as small text next to
 * the badge (used on the listing detail page only, per spec — cards just
 * show the badge itself).
 */
export function PriceBadge({
  evaluation,
  showCount,
  className,
}: {
  evaluation: PriceEvaluation;
  showCount?: boolean;
  className?: string;
}) {
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className={clsx("badge", LABEL_CLASSES[evaluation.label])}>{labelText(evaluation)}</span>
      {showCount && (
        <span className="text-xs text-gray-400">porovnáno s {evaluation.comparableCount} auty</span>
      )}
    </span>
  );
}
