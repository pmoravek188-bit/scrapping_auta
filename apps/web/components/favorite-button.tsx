"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Toggles a row in `public.favorites` (a real per-user list, not tied to any
 * saved search — see supabase/migrations/20260928220000_favorites.sql), so
 * this works on every page that shows a listing (home, both /results
 * scopes, listing detail), not just the "Moje hledání" scope a `matches`
 * row used to require.
 */
export function FavoriteButton({
  listingId,
  initialFavorite,
}: {
  listingId: string;
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
    let error = null;
    if (next) {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userId) {
        ({ error } = await supabase.from("favorites").upsert({ user_id: userId, listing_id: listingId }));
      }
    } else {
      ({ error } = await supabase.from("favorites").delete().eq("listing_id", listingId));
    }
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
