"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { markAllSeenNow } from "@/app/actions/user-state";

/** Task F: "Označit vše jako viděné" — collapses the results-seen watermark
 * to now, immediately clearing every "NOVÉ" badge. */
export function MarkSeenButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function click() {
    setBusy(true);
    await markAllSeenNow();
    setBusy(false);
    router.refresh();
  }

  return (
    <button type="button" className="btn-ghost" onClick={click} disabled={busy}>
      <CheckCheck className="h-4 w-4" aria-hidden />
      Označit vše jako viděné
    </button>
  );
}
