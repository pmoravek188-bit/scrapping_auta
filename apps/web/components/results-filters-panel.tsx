"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { MakeOption, ModelOption } from "@scrapping-auta/core";
import { ResultsFilters, type ResultsFilterValues } from "@/components/results-filters";

/** Desktop: always-visible sidebar. Mobile: a "Filtry" button that opens a
 * slide-over drawer containing the same filter form. */
export function ResultsFiltersPanel(props: {
  initial: ResultsFilterValues;
  makes: MakeOption[];
  makeModels: Record<string, ModelOption[]>;
  availableSources: { id: string; name: string }[];
  extraParams: Record<string, string | undefined>;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-72 flex-shrink-0 lg:block">
        <div className="card sticky top-4">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filtry
          </h2>
          <ResultsFilters {...props} />
        </div>
      </aside>

      {/* Mobile trigger */}
      <button type="button" className="btn-secondary w-full lg:hidden" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        Filtry
        {props.activeCount > 0 && (
          <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[11px] font-semibold text-white">
            {props.activeCount}
          </span>
        )}
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-full max-w-sm overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                Filtry
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Zavřít filtry"
                className="rounded-full p-1 hover:bg-gray-100"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <ResultsFilters {...props} onApplied={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
