"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function FavoriteButton({
  matchId,
  initialFavorite,
}: {
  matchId: string;
  initialFavorite: boolean;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const supabase = createSupabaseBrowserClient();
    if (!supabase || busy) return;
    setBusy(true);
    const next = !favorite;
    const { error } = await supabase
      .from("matches")
      .update({ status: next ? "favorite" : "new" })
      .eq("id", matchId);
    setBusy(false);
    if (!error) {
      setFavorite(next);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={favorite}
      aria-label={favorite ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
      className="rounded-full bg-white/90 p-1.5 shadow-sm transition hover:scale-105 disabled:opacity-60"
    >
      <Heart
        className={clsx("h-4 w-4", favorite ? "fill-red-500 text-red-500" : "text-gray-500")}
        aria-hidden
      />
    </button>
  );
}
