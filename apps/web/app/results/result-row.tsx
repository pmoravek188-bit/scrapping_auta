"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CarCard, type CarCardListing } from "@/components/car-card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface ResultRowData {
  listing: CarCardListing & { group_id: string | null };
}

export function ResultRow({
  matchId,
  status,
  listing,
  offerCount,
  favorite,
}: {
  matchId?: string;
  status?: string;
  listing: CarCardListing;
  offerCount: number;
  /** From public.favorites, fetched per-page by the caller — see
   * apps/web/app/results/page.tsx. Independent of `status`/`matchId`, which
   * are about the (optional) saved-search match, not the favourites list. */
  favorite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(status === "hidden");

  async function hide() {
    // Hiding is a `matches.status = 'hidden'` update, which only exists for
    // the "Moje hledání" scope (a match row belongs to a search). In the
    // "Všechna auta" scope there is no match row to hide, so this action
    // isn't offered there (see car-card.tsx: `onHide` is only passed when
    // `matchId` is set) — a known limitation, see README.md.
    if (!matchId) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from("matches").update({ status: "hidden" }).eq("id", matchId);
    setBusy(false);
    if (!error) {
      setHidden(true);
      router.refresh();
    }
  }

  if (hidden) return null;

  return (
    <CarCard
      listing={{ ...listing, group_offer_count: offerCount }}
      matchId={matchId}
      favorite={favorite}
      onHide={matchId ? hide : undefined}
      hideBusy={busy}
      hideOnImageError
    />
  );
}
