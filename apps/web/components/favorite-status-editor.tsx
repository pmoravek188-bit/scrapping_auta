"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { FAVORITE_STATUS_LABELS, FAVORITE_STATUS_ORDER, type FavoriteStatus } from "@/lib/format";

/**
 * Per-favourite status pipeline (chips) + note editing — shared between the
 * Oblíbené card (favorite-card.tsx) and the listing detail page, so both
 * stay in sync with the same `public.favorites.status`/`note` columns (see
 * supabase/migrations/20261004000000_favorites_status.sql). Chips wrap
 * instead of scrolling horizontally, per the mobile-first rule.
 */
export function FavoriteStatusEditor({
  listingId,
  status,
  note,
}: {
  listingId: string;
  status: FavoriteStatus;
  note: string | null;
}) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<FavoriteStatus>(status);
  const [statusBusy, setStatusBusy] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(note ?? "");
  const [savingNote, setSavingNote] = useState(false);

  async function setStatus(next: FavoriteStatus) {
    if (next === currentStatus) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase || statusBusy) return;
    setStatusBusy(true);
    const { error } = await supabase.from("favorites").update({ status: next }).eq("listing_id", listingId);
    setStatusBusy(false);
    if (!error) {
      setCurrentStatus(next);
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
      .eq("listing_id", listingId);
    setSavingNote(false);
    if (!error) {
      setEditingNote(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {FAVORITE_STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            disabled={statusBusy}
            className={`chip ${currentStatus === s ? "chip-active" : "chip-inactive"}`}
          >
            {FAVORITE_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

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
            <button type="button" onClick={saveNote} disabled={savingNote} className="btn-secondary h-8 py-1 text-xs">
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
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
        >
          <Pencil className="h-3 w-3" aria-hidden />
          {note ? note : "Přidat poznámku"}
        </button>
      )}
    </div>
  );
}
