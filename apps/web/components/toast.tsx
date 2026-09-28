"use client";

import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";

/** Minimal self-contained toast — no global provider, just a fixed-position
 * banner a page/component shows while its own local `message` state is set.
 * Auto-dismisses after `durationMs` via the caller's `onDone`. */
export function Toast({
  message,
  onDone,
  durationMs = 4000,
}: {
  message: string;
  onDone: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [onDone, durationMs]);

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" aria-hidden />
        {message}
      </div>
    </div>
  );
}
