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
  error?: string;
  message?: string;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** "Spustit scraping" button: triggers the GitHub Actions scrape workflow via
 * POST /api/scrape and polls GET /api/scrape for status while a run is queued
 * or in progress. */
export function ScrapeTrigger({ sources }: { sources: { id: string; name: string }[] }) {
  const router = useRouter();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [source, setSource] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = run?.status === "queued" || run?.status === "in_progress";

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/scrape", { cache: "no-store" });
      const data = (await res.json()) as ScrapeApiResponse;
      setConfigured(data.configured);
      setRun(data.run ?? null);
      return data.run ?? null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

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
      } else {
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
          Spustit scraping
        </button>
        <p className="mt-1">Chybí GITHUB_DISPATCH_TOKEN ve Vercelu.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sources.length > 0 && (
        <select
          className="input w-auto text-sm"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={isRunning}
        >
          <option value="">Vše</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn" onClick={trigger} disabled={isRunning || triggering}>
        {isRunning ? (
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <PlayCircle className="h-4 w-4" aria-hidden />
        )}
        {isRunning ? "Běží…" : triggering ? "Spouštím…" : "Spustit scraping"}
      </button>
      {run && !isRunning && (
        <a
          href={run.html_url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-700"
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
