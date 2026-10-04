"use client";

import { Scale } from "lucide-react";
import clsx from "clsx";
import { useCompareIds } from "@/lib/compare-store";

/** Icon-button "Porovnat" toggle shown on every car card, next to the
 * favourite heart — adds/removes the listing from the client-side compare
 * selection (localStorage, max 3 — see lib/compare-store.ts). Disabled
 * (rather than hidden) once 3 are already selected and this one isn't among
 * them, so the 3-max limit is visible rather than silently unreachable. */
export function CompareToggle({ listingId }: { listingId: string }) {
  const { isSelected, toggle, isFull } = useCompareIds();
  const selected = isSelected(listingId);
  const disabled = isFull && !selected;

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    toggle(listingId);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={selected ? "Odebrat z porovnání" : "Přidat do porovnání"}
      title={disabled ? "Lze porovnat maximálně 3 auta" : undefined}
      className="rounded-full bg-white/90 p-1.5 shadow-sm transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Scale className={clsx("h-4 w-4", selected ? "text-brand-600" : "text-gray-500")} aria-hidden />
    </button>
  );
}
