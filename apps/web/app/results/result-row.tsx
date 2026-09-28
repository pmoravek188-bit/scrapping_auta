"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EyeOff } from "lucide-react";
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
}: {
  matchId: string;
  status: string;
  listing: CarCardListing;
  offerCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(status === "hidden");

  async function hide() {
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
    <div className="relative">
      <CarCard
        listing={{ ...listing, group_offer_count: offerCount }}
        matchId={matchId}
        favorite={status === "favorite"}
      />
      <button
        type="button"
        disabled={busy}
        onClick={hide}
        title="Skrýt nabídku"
        className="absolute bottom-2 left-2 rounded-full bg-white/90 p-1.5 shadow-sm transition hover:scale-105 disabled:opacity-60"
      >
        <EyeOff className="h-4 w-4 text-gray-500" aria-hidden />
      </button>
    </div>
  );
}
