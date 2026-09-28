"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CarCard, type CarCardListing } from "@/components/car-card";

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

  async function setStatus(next: "favorite" | "hidden" | "new") {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    await supabase.from("matches").update({ status: next }).eq("id", matchId);
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <CarCard listing={{ ...listing, group_offer_count: offerCount }} />
      <div className="mt-1 flex gap-2 text-xs">
        <button
          disabled={busy}
          onClick={() => setStatus(status === "favorite" ? "new" : "favorite")}
          className="btn-secondary"
        >
          {status === "favorite" ? "★ Oblíbené" : "☆ Oblíbit"}
        </button>
        <button disabled={busy} onClick={() => setStatus("hidden")} className="btn-secondary">
          Skrýt
        </button>
      </div>
    </div>
  );
}
