import type { ListingHistorySummary } from "@scrapping-auta/core";
import { formatCzk } from "@/lib/format";

/** "inzerováno 45 dní · zlevněno 2× (−35 000 Kč)" — see
 * packages/core/src/listing-history.ts for the underlying computation. */
export function ListingHistoryLine({
  history,
  className,
}: {
  history: ListingHistorySummary;
  className?: string;
}) {
  return (
    <div className={className ?? "text-xs text-gray-400"}>
      inzerováno {history.daysListed} {daysWord(history.daysListed)}
      {history.priceDropCount > 0 && (
        <> · zlevněno {history.priceDropCount}× (−{formatCzk(history.totalDropCzk)})</>
      )}
    </div>
  );
}

/** Czech noun declension for "den" (day): 1 den, 2-4 dny, 0/5+ dní. */
function daysWord(n: number): string {
  if (n === 1) return "den";
  if (n >= 2 && n <= 4) return "dny";
  return "dní";
}
