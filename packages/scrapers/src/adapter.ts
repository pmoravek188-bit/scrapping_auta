import type { RawListing, SearchQuery } from "@scrapping-auta/core";

export interface SourceContext {
  /** Current EUR->CZK rate, for adapters that need to reason about price in CZK client-side. */
  eurCzkRate: number;
  /** Max number of result pages to walk per search (default from http.ts MAX_RESULT_PAGES). */
  maxPages?: number;
  /**
   * Called by an adapter's `search()` when its result-page loop hit
   * `maxPages` while the last page fetched still looked full/non-terminal
   * (i.e. it stopped ONLY because of the cap, not because results actually
   * ran out) — more matching listings may exist beyond it. Lets the caller
   * (see packages/scrapers/src/runner.ts) surface a warning on
   * `scrape_runs.errors`, the same way the gone-check circuit breaker does,
   * instead of silently truncating. Optional: omitted by callers that don't
   * need it (dry-run CLI, scripts/audit.ts, most unit tests).
   */
  onPageCapHit?: () => void;
}

export interface SourceAdapter {
  /** Stable id matching the `sources` table, e.g. "sauto". */
  id: string;
  /** True if this source requires a headless browser (not implemented in MVP). */
  needsBrowser?: boolean;
  /** Whether this adapter has been verified against the live site (see README). */
  verified: boolean;
  /** Fetches raw listings from the source matching the given query. */
  search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]>;
  /**
   * Optional: fetches ONE listing's detail page/endpoint and returns a
   * single free-text blob (description + equipment/feature list + any
   * structured wheelbase/length text the source exposes) for near-match
   * feature re-detection — see the runner's detail-enrichment pass
   * (packages/scrapers/src/runner.ts) and `detail_text_cache`.
   *
   * Uses the same throttled/retried `politeFetch` (via fetchText/fetchJson
   * in http.ts) as `search()` — no separate rate limiting needed by callers
   * beyond capping how many listings they call this for per run.
   *
   * Returns `null` (never throws) on any failure — a 404, a parse error, a
   * network timeout — so a bad detail fetch just means "no extra text this
   * time", never aborts the run.
   */
  fetchDetailText?(listing: { url: string; sourceId: string }): Promise<string | null>;
}
