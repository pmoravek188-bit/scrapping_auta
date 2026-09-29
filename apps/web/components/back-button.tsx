"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * In-page "back to results" control for the listing detail. The browser's
 * own back arrow isn't always usable (iOS Safari after returning from a
 * listing opened in a new tab, in-app browsers), so: if there is a previous
 * history entry, go back to it (keeps the results' filters and scroll
 * position); a tab opened directly on a detail has none, so fall back to
 * the results page. (`document.referrer` isn't usable here: it doesn't
 * change on client-side navigation.)
 */
export function BackButton({ fallbackHref = "/results" }: { fallbackHref?: string }) {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }

  return (
    <button type="button" onClick={goBack} className="btn-ghost -ml-2">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Zpět na výsledky
    </button>
  );
}
