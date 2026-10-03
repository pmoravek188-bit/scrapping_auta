"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Lets a deeply-nested `CarImage` (inside `CarCard`, which can itself be
 * rendered as a Server Component — see car-card.tsx) signal "my image
 * failed to load" up to a client-side wrapper that hides the WHOLE card,
 * instead of `CarImage`'s own default behaviour of swapping in a small
 * placeholder icon.
 *
 * Plain React state can't cross the Server/Client boundary that way, so
 * this uses context instead: `HideOnImageError` (client) provides a
 * "report an error" callback; `CarImage` calls it (in addition to its own
 * local placeholder state) when present. Outside a `HideOnImageError`
 * provider (favorites, listing detail, the gallery) the context is `null`
 * and `CarImage` just falls back to its normal placeholder-icon behaviour —
 * see README/task notes: those pages keep the placeholder on purpose,
 * since the user saved/is looking at that listing deliberately.
 */
const ReportImageErrorContext = createContext<(() => void) | null>(null);

export function useReportImageError(): (() => void) | null {
  return useContext(ReportImageErrorContext);
}

/** Wraps a card so that if ANY `CarImage` inside it reports a load error,
 * the whole subtree unmounts (renders nothing) instead of showing a
 * placeholder icon. */
export function HideOnImageError({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <ReportImageErrorContext.Provider value={() => setHidden(true)}>
      {children}
    </ReportImageErrorContext.Provider>
  );
}
