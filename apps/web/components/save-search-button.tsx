"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus } from "lucide-react";
import type { BodyType, DriveType, FuelType, TransmissionType } from "@scrapping-auta/core";
import { saveSearchAndRematch } from "@/app/actions/rematch";
import { Toast } from "@/components/toast";

export interface CurrentFilters {
  make: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  price_from: number | null;
  price_to: number | null;
  mileage_max: number | null;
  power_min_kw: number | null;
  fuel: FuelType[];
  body: BodyType[];
  transmission: TransmissionType | null;
  sources: string[];
  drive: DriveType[];
  features: string[];
}

/** Task C: "Uložit jako hledání" on /results — takes the currently-applied
 * filters (already normalized by the caller), asks for a name, then saves
 * a new search and instantly rematches it (task D), via the shared
 * `saveSearchAndRematch` server action also used by the /searches form. */
export function SaveSearchButton({ filters }: { filters: CurrentFilters }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const result = await saveSearchAndRematch({
      name: name || "Bez názvu",
      enabled: true,
      notify: true,
      ...filters,
      keywords: [],
      exclude_keywords: [],
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Uložení se nezdařilo.");
      return;
    }
    setOpen(false);
    setToast(
      `Hledání uloženo · nalezeno ${result.matchCount ?? 0} aut` +
        (result.scrapeTriggered ? " · spuštěno stahování nových" : "")
    );
    setTimeout(() => {
      router.push(`/results?search=${result.searchId}`);
      router.refresh();
    }, 1200);
  }

  if (!open) {
    return (
      <>
        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          <BookmarkPlus className="h-4 w-4" aria-hidden />
          Uložit jako hledání
        </button>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        className="input w-56"
        placeholder="Název hledání"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn" disabled={saving}>
        {saving ? "Ukládám…" : "Uložit"}
      </button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
        Zrušit
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
