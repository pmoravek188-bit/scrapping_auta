"use client";

import { EyeOff } from "lucide-react";

/** Small round icon button for "Skrýt nabídku" (task E), mirroring
 * favorite-button.tsx's self-contained click handling. Must stay a real
 * Client Component: car-card.tsx is rendered both as a genuine Server
 * Component (apps/web/app/page.tsx) and as a client-rendered component
 * (apps/web/app/results/result-row.tsx), and a Server Component's own JSX
 * can never attach a raw DOM event handler (that previously crashed every
 * page with car cards — see the fix in this same change). Delegating the
 * click handling to this dedicated Client Component keeps CarCard's own
 * markup handler-free in both contexts. */
export function HideButton({ onHide, busy }: { onHide: () => void; busy?: boolean }) {
  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onHide();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleClick}
      title="Skrýt nabídku"
      className="rounded-full bg-white/90 p-1.5 shadow-sm transition hover:scale-105 disabled:opacity-60"
    >
      <EyeOff className="h-4 w-4 text-gray-500" aria-hidden />
    </button>
  );
}
