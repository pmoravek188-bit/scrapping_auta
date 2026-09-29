"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, TrendingDown, TrendingUp, Pencil } from "lucide-react";
import { CarCard, type CarCardListing } from "@/components/car-card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatCzk, formatDate } from "@/lib/format";

export interface FavoriteCardData {
  listing: CarCardListing & { is_active: boolean };
  createdAt: string;
  note: string | null;
  /** First known price at/after the favourite was added, for the "change
   * since added" indicator. Null when there's no price history for that
   * window (e.g. price never changed since). */
  priceAtAdd: number | null;
}

export function FavoriteCard({ listing, createdAt, note, priceAtAdd }: FavoriteCardData) {
  const router = useRouter();
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(note ?? "");
  const [savingNote, setSavingNote] = useState(false);

  async function remove() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.from("favorites").delete().eq("listing_id", listing.id);
    setBusy(false);
    if (!error) {
      setRemoved(true);
      router.refresh();
    }
  }

  async function saveNote() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setSavingNote(true);
    const { error } = await supabase
      .from("favorites")
      .update({ note: noteValue.trim() || null })
      .eq("listing_id", listing.id);
    setSavingNote(false);
    if (!error) {
      setEditingNote(false);
      router.refresh();
    }
  }

  if (removed) return null;

  const priceDiff =
    priceAtAdd != null && listing.price_czk != null ? listing.price_czk - priceAtAdd : null;

  return (
    <div>
      <CarCard listing={listing} favorite />
      <div className="mt-2 space-y-1.5 rounded-lg border border-gray-200 bg-white p-2.5 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>Přidáno {formatDate(createdAt)}</span>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1 text-red-500 hover:text-red-600 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Odebrat
          </button>
        </div>

        {!listing.is_active && (
          <div className="badge bg-gray-800 text-white">Nedostupné / prodáno</div>
        )}

        {priceDiff != null && priceDiff !== 0 && (
          <div
            className={`inline-flex items-center gap-1 font-medium ${priceDiff < 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {priceDiff < 0 ? (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            )}
            {priceDiff < 0 ? "" : "+"}
            {formatCzk(priceDiff)} od přidání
          </div>
        )}

        {editingNote ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              rows={2}
              className="input text-xs"
              placeholder="Poznámka…"
            />
            <div className="flex gap-2">
              <button type="button" onClick={saveNote} disabled={savingNote} className="btn-secondary py-1 text-xs">
                Uložit
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingNote(false);
                  setNoteValue(note ?? "");
                }}
                className="btn-ghost py-1 text-xs"
              >
                Zrušit
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingNote(true)}
            className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-600"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            {note ? note : "Přidat poznámku"}
          </button>
        )}
      </div>
    </div>
  );
}
