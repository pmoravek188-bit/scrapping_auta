"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Porovnat" (compare) selection: purely client-side, kept in localStorage
 * (no DB table needed — this is an ephemeral, per-device UI selection, not
 * data the user needs synced across devices or shown to anyone else). Used
 * by the compare-toggle button on each card, the sticky bottom bar, and the
 * /compare page itself (which reads the ids from the URL, not this store —
 * see app/compare/page.tsx).
 */
const STORAGE_KEY = "scrapping-auta:compare-ids";
export const MAX_COMPARE = 3;
/** Fired on the same tab after a write, so every mounted `useCompareIds()`
 * instance re-reads — the native `storage` event only fires in OTHER tabs. */
const LOCAL_CHANGE_EVENT = "scrapping-auta:compare-ids-changed";

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
  } catch {
    // Private browsing / storage disabled / quota exceeded — the selection
    // just won't persist this session, nothing to recover from here.
  }
}

export interface CompareIdsState {
  ids: string[];
  isSelected: (id: string) => boolean;
  /** Adds `id` if not already selected and under MAX_COMPARE; removes it if
   * already selected. No-ops (doesn't add) when already at MAX_COMPARE. */
  toggle: (id: string) => void;
  clear: () => void;
  isFull: boolean;
}

export function useCompareIds(): CompareIdsState {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(readIds());
    function onChange() {
      setIds(readIds());
    }
    window.addEventListener(LOCAL_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(LOCAL_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    const current = readIds();
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : current.length < MAX_COMPARE
        ? [...current, id]
        : current;
    writeIds(next);
    setIds(next);
  }, []);

  const clear = useCallback(() => {
    writeIds([]);
    setIds([]);
  }, []);

  return { ids, isSelected: (id) => ids.includes(id), toggle, clear, isFull: ids.length >= MAX_COMPARE };
}
