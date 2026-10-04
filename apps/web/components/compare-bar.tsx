"use client";

import Link from "next/link";
import { X, Scale } from "lucide-react";
import { useCompareIds } from "@/lib/compare-store";

/** Sticky bottom bar shown whenever at least 2 cars are selected for compare
 * (comparing a single car isn't useful). Mounted globally in AppShell so it
 * persists across navigation. Padded for the iOS home indicator / Android
 * gesture bar the same way the rest of the app is (env(safe-area-inset-*)). */
export function CompareBar() {
  const { ids, clear } = useCompareIds();
  if (ids.length < 2) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={clear}
          aria-label="Zrušit porovnání"
          className="btn-ghost -ml-2 flex-shrink-0"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <Link href={`/compare?ids=${ids.join(",")}`} className="btn flex-1 justify-center sm:flex-none">
          <Scale className="h-4 w-4" aria-hidden />
          Porovnat ({ids.length})
        </Link>
      </div>
    </div>
  );
}
