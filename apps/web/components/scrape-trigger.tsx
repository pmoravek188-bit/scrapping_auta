"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle, RefreshCw, ExternalLink } from "lucide-react";

interface RunStatus {
  status: string; // "queued" | "in_progress" | "completed" | ...
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

interface ScrapeApiResponse {
  configured: boolean;
  run?: RunStatus | null;
  nextAllowedAt?: string | null;
  error?: string;
  message?: string;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function formatHHMM(iso: string): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  }).format(new Date(iso));
}

/** "Spustit scraping mých hledání" button: triggers the GitHub Actions scrape
 * workflow (scoped to the signed-in user's own searches — see
 * apps/web/app/api/scrape/route.ts) via POST /api/scrape and polls GET
 * /api/scrape for status while a run is queued or in progress. Also disabled
 * while a previous manual trigger's 2-hour cooldown (`nextAllowedAt`) hasn't
 * elapsed yet. */
export function ScrapeTrigger({ sources }: { sources: { id: string; name: string }[] }) {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [nextAllowedAt, setNextAllowedAt] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = run?.status === "queued" || run?.status === "in_progress";
  const rateLimited = nextAllowedAt != null && now < new Date(nextAllowedAt).getTime();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/scrape", { cache: "no-store" });
      const data = (await res.json()) as ScrapeApiResponse;
      setConfigured(data.configured);
      setRun(data.run ?? null);
      setNextAllowedAt(data.nextAllowedAt ?? null);
      return data.run ?? null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Ticks every 30s while rate-limited, so the button re-enables itself once
  // `nextAllowedAt` passes without needing a reload.
  useEffect(() => {
    if (!rateLimited) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [rateLimited]);

  useEffect(() => {
    if (isRunning && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const latest = await fetchStatus();
        if (latest && latest.status !== "queued" && latest.status !== "in_progress") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          router.refresh();
        }
      }, 10_000);
    }
    if (!isRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [isRunning, fetchStatus, router]);

  async function trigger() {
    setError(null);
    setTriggering(true);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: source || undefined }),
      });
      const data = (await res.json()) as ScrapeApiResponse;
      if (!res.ok) {
        setError(data.message || "Spuštění se nezdařilo.");
        if (data.nextAllowedAt) setNextAllowedAt(data.nextAllowedAt);
      } else {
        // Optimistic: the server just recorded this trigger, so the next
        // one is MANUAL_SCRAPE_COOLDOWN_HOURS away — fetchStatus below picks
        // up the authoritative value a few seconds later regardless.
        setNextAllowedAt(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());
        setNow(Date.now());
        // GitHub takes a few seconds to register the new run.
        setTimeout(fetchStatus, 3000);
      }
    } catch {
      setError("Spuštění se nezdařilo.");
    } finally {
      setTriggering(false);
    }
  }

  if (configured === false) {
    return (
      <div className="text-xs text-gray-400" title="Chybí GITHUB_DISPATCH_TOKEN ve Vercelu">
        <button type="button" className="btn-secondary" disabled>
          <PlayCircle className="h-4 w-4" aria-hidden />
          Spustit scraping mých hledání
        </button>
        <p className="mt-1">Chybí GITHUB_DISPATCH_TOKEN ve Vercelu.</p>
      </div>
    );
  }

  const disabled = isRunning || triggering || rateLimited;
  const reason = !isRunning && rateLimited && nextAllowedAt
    ? `Další ruční spuštění bude možné v ${formatHHMM(nextAllowedAt)}.`
    : null;

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {sources.length > 0 && (
        <select
          aria-label="Zdroj"
          className="input !w-40 shrink-0 text-sm"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={isRunning}
        >
          <option value="">Všechny zdroje</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="btn-secondary shrink-0 whitespace-nowrap"
        onClick={trigger}
        disabled={disabled}
        title={reason ?? undefined}
      >
        {isRunning ? (
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <PlayCircle className="h-4 w-4" aria-hidden />
        )}
        {isRunning ? "Běží…" : triggering ? "Spouštím…" : "Spustit scraping mých hledání"}
      </button>
      {reason && <p className="w-full text-xs text-gray-500 sm:w-auto">{reason}</p>}
      {run && !isRunning && (
        <a
          href={run.html_url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-gray-500 hover:text-brand-700"
        >
          {run.conclusion === "success" ? "Hotovo" : run.conclusion === "failure" ? "Chyba" : run.status}{" "}
          před {minutesAgo(run.created_at)} min
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
