/**
 * Turns the raw machine-oriented text the scraper writes to
 * `scrape_runs.errors` (see packages/scrapers/src/runner.ts) into something
 * presentable on the "Stav zdrojů" page: short, Czech, human-friendly, and
 * never leaking a URL, stack trace or raw English sentence to the UI.
 *
 * `errors` is built by runner.ts as up to four pieces joined with "; ":
 *   - the source's own thrown error (e.g. `[aaaauto] request failed on page
 *     0: HTTP 404 for https://...`, or `[aaaauto] response doesn't look
 *     like a real aaaauto.cz page (possible bot/geo-block) at https://...`)
 *   - `[search] <source>: N/M queries failed: <first failure>(+K more)`
 *   - `[gone] <source>: suspicious gone ratio N/M, skipping deletions`
 *   - `[pages] <source>: hit page cap N for search <name>` (one per hit,
 *     itself "; "-joined when several searches hit the cap)
 * Each of those pieces never contains an embedded "; " of its own, so
 * splitting the whole string on "; " and classifying each piece
 * independently is safe.
 */

export type ScrapeIssueKind = "error" | "blocked" | "page_cap" | "gone_guard" | "other";

export interface ScrapeIssue {
  kind: ScrapeIssueKind;
  source?: string;
  searchName?: string;
  /** Short, Czech, human-friendly — safe to render directly. */
  message: string;
}

export type ScrapeStatusLevel = "ok" | "warning" | "error";

export interface ScrapeStatus {
  level: ScrapeStatusLevel;
  /** One-line Czech summary, safe for a compact badge/row. */
  summary: string;
  issues: ScrapeIssue[];
}

/** Kinds serious enough to turn the status badge red rather than amber. */
const HARD_KINDS: readonly ScrapeIssueKind[] = ["error", "blocked", "other"];

const BLOCKED_PATTERN = /doesn'?t look like a real|possible[ -](bot|block|geo-block|waf)|bot[-/]geo-block|bot-mitigation/i;
const NETWORK_PATTERN = /time(d)?\s*-?\s*out|aborted|fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i;

function classifyMessage(text: string): { kind: ScrapeIssueKind; message: string } {
  if (BLOCKED_PATTERN.test(text)) {
    return { kind: "blocked", message: "Web nás zablokoval" };
  }
  const httpMatch = text.match(/HTTP\s+(\d{3})/);
  if (httpMatch) {
    const code = Number(httpMatch[1]);
    if (code === 403 || code === 429) {
      return { kind: "blocked", message: "Web nás zablokoval" };
    }
    return { kind: "error", message: "Web neodpověděl" };
  }
  if (NETWORK_PATTERN.test(text)) {
    return { kind: "error", message: "Web neodpověděl" };
  }
  return { kind: "other", message: "Chyba při stahování" };
}

function parseSegment(segment: string): ScrapeIssue {
  let m = segment.match(/^\[pages]\s*([\w.-]+):\s*hit page cap (\d+) for search (.+)$/i);
  if (m) {
    const [, source, cap, searchName] = m as unknown as [string, string, string, string];
    return {
      kind: "page_cap",
      source,
      searchName,
      message: `Nestaženo vše pro hledání „${searchName}“ (limit ${cap} stran)`,
    };
  }

  m = segment.match(/^\[gone]\s*([\w.-]+):\s*suspicious gone ratio/i);
  if (m) {
    const [, source] = m as unknown as [string, string];
    return { kind: "gone_guard", source, message: "Mazání zmizelých inzerátů přeskočeno (podezřele mnoho)" };
  }

  m = segment.match(/^\[search]\s*([\w.-]+):\s*\d+\/\d+\s*quer(?:y|ies)\s+failed:\s*(.+)$/i);
  if (m) {
    const [, source, rest] = m as unknown as [string, string, string];
    const classified = classifyMessage(rest);
    return { kind: classified.kind, source, message: classified.message };
  }

  m = segment.match(/^\[([\w.-]+)]\s*(.+)$/);
  if (m) {
    const [, source, rest] = m as unknown as [string, string, string];
    const classified = classifyMessage(rest);
    return { kind: classified.kind, source, message: classified.message };
  }

  const classified = classifyMessage(segment);
  return { kind: classified.kind, message: classified.message };
}

/** Parses a raw `scrape_runs.errors` string into structured, Czech,
 * human-friendly issues. Returns `[]` for empty/null/undefined input. */
export function parseScrapeErrors(raw: string | null | undefined): ScrapeIssue[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split("; ")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(parseSegment);
}

/** Rolls a list of issues up into a single badge level + one-line summary.
 * `page_cap`/`gone_guard` alone (the source still returned cars, just with
 * a caveat) only ever produce "warning" (amber); any `error`/`blocked`/
 * `other` issue makes it "error" (red). No issues at all is "ok" (green). */
export function summarizeScrapeIssues(issues: ScrapeIssue[]): ScrapeStatus {
  if (issues.length === 0) {
    return { level: "ok", summary: "Bez chyb", issues: [] };
  }

  const hasHardIssue = issues.some((issue) => HARD_KINDS.includes(issue.kind));
  const level: ScrapeStatusLevel = hasHardIssue ? "error" : "warning";
  const primary = issues.find((issue) => HARD_KINDS.includes(issue.kind)) ?? issues[0]!;
  const summary = issues.length === 1 ? primary.message : `${primary.message} (+${issues.length - 1})`;

  return { level, summary, issues };
}

/** Convenience wrapper: raw `scrape_runs.errors` string straight to a
 * ready-to-render status. */
export function getScrapeStatus(raw: string | null | undefined): ScrapeStatus {
  return summarizeScrapeIssues(parseScrapeErrors(raw));
}
