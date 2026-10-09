import clsx from "clsx";
import type { ScrapeStatus, ScrapeStatusLevel } from "@/lib/scrape-status";

const LEVEL_STYLES: Record<ScrapeStatusLevel, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

const LEVEL_LABELS: Record<ScrapeStatusLevel, string> = {
  ok: "OK",
  warning: "Upozornění",
  error: "Chyba",
};

/** Compact status badge ("OK" green / "Upozornění" amber / "Chyba" red) —
 * no raw text, just the level label. */
export function ScrapeStatusPill({ level }: { level: ScrapeStatusLevel }) {
  return <span className={clsx("badge", LEVEL_STYLES[level])}>{LEVEL_LABELS[level]}</span>;
}

/**
 * Full presentation for one scrape status: the compact badge + a short
 * Czech one-line summary, with the friendly issue list hidden behind a
 * "Podrobnosti" toggle and the raw machine text hidden one level deeper
 * behind "Technické detaily" (small monospace, wrapped so it never
 * overflows on mobile) — see apps/web/lib/scrape-status.ts.
 */
export function ScrapeStatusDisplay({ status, raw }: { status: ScrapeStatus; raw?: string | null }) {
  const hasDetails = status.issues.length > 0;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <ScrapeStatusPill level={status.level} />
        <span className="min-w-0 truncate text-gray-600">{status.summary}</span>
      </div>
      {hasDetails && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-xs text-gray-400 hover:text-gray-600">
            Podrobnosti
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-gray-600">
            {status.issues.map((issue, i) => (
              <li key={i} className="break-words">
                {issue.message}
              </li>
            ))}
          </ul>
          {raw && (
            <details className="mt-1">
              <summary className="cursor-pointer select-none text-xs text-gray-400 hover:text-gray-600">
                Technické detaily
              </summary>
              <pre className="mt-1 max-w-full whitespace-pre-wrap break-words font-mono text-[11px] text-gray-400">
                {raw}
              </pre>
            </details>
          )}
        </details>
      )}
    </div>
  );
}
