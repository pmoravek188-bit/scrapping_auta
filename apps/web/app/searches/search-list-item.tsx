"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatCzk } from "@/lib/format";

export interface SearchRow {
  id: string;
  name: string;
  enabled: boolean;
  make: string | null;
  model: string | null;
  price_from: number | null;
  price_to: number | null;
  year_from: number | null;
  year_to: number | null;
}

export function SearchListItem({ search }: { search: SearchRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(search.enabled);

  async function toggle() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    const next = !enabled;
    const { error } = await supabase.from("searches").update({ enabled: next }).eq("id", search.id);
    if (!error) setEnabled(next);
    setBusy(false);
  }

  async function remove() {
    if (!confirm(`Opravdu smazat hledání "${search.name}"?`)) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    await supabase.from("searches").delete().eq("id", search.id);
    router.refresh();
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <Link href={`/results?search=${search.id}`} className="font-semibold hover:underline">
            {search.name}
          </Link>
          {!enabled && (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">vypnuto</span>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {[
            search.make,
            search.model,
            search.year_from || search.year_to
              ? `${search.year_from ?? ""}–${search.year_to ?? ""}`
              : null,
            search.price_from || search.price_to
              ? `${formatCzk(search.price_from)}–${formatCzk(search.price_to)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || "bez filtrů"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/results?search=${search.id}`} className="btn-secondary">
          Výsledky
        </Link>
        <Link href={`/searches/${search.id}/edit`} className="btn-secondary">
          Upravit
        </Link>
        <button className="btn-secondary" disabled={busy} onClick={toggle}>
          {enabled ? "Vypnout" : "Zapnout"}
        </button>
        <button className="btn-secondary text-red-600" disabled={busy} onClick={remove}>
          Smazat
        </button>
      </div>
    </div>
  );
}
