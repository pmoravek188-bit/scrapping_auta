/**
 * Shared server-side helper for triggering/checking the GitHub Actions
 * scrape workflow. Used by both `app/api/scrape/route.ts` (the "Spustit
 * scraping mých hledání" button on /sources) and the instant-rematch server
 * action (`app/actions/rematch.ts`, task D: auto-trigger a scrape right
 * after a search is saved/updated, so newly-relevant listings show up
 * quickly).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@scrapping-auta/core";

type Db = SupabaseClient<Database>;

const DEFAULT_REPO = "pmoravek188-bit/scrapping_auta";
const DEFAULT_REF = "claude/car-search-app-y4b753";

/** One manual "Spustit scraping mých hledání" run per user per this many
 * hours — enforced server-side (see `decideManualScrapeTrigger` below) via
 * `public.manual_scrape_requests` (supabase/migrations/
 * 20261009000000_manual_scrape_requests.sql). */
export const MANUAL_SCRAPE_COOLDOWN_HOURS = 2;

export interface GithubDispatchConfig {
  token: string;
  repo: string;
  ref: string;
}

export function githubConfig(): GithubDispatchConfig | null {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const ref = process.env.GITHUB_REF || DEFAULT_REF;
  if (!token) return null;
  return { token, repo, ref };
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface WorkflowRunStatus {
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

/** Latest scrape.yml workflow run, or null if none / not configured. */
export async function getLatestScrapeRun(
  config: GithubDispatchConfig
): Promise<WorkflowRunStatus | null> {
  const res = await fetch(
    `https://api.github.com/repos/${config.repo}/actions/workflows/scrape.yml/runs?per_page=1`,
    { headers: githubHeaders(config.token), cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { workflow_runs?: WorkflowRunStatus[] };
  return data.workflow_runs?.[0] ?? null;
}

/** Dispatches a scrape.yml workflow_dispatch run, optionally for one source
 * and/or scoped to one user (see scrape.yml's `user_id` input and
 * runner.ts's RunOptions.userFilter — passing `userId` makes the run only
 * process/notify that one user). */
export async function dispatchScrape(
  config: GithubDispatchConfig,
  source?: string,
  userId?: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const inputs: Record<string, string> = {};
  if (source) inputs.source = source;
  if (userId) inputs.user_id = userId;
  const res = await fetch(
    `https://api.github.com/repos/${config.repo}/actions/workflows/scrape.yml/dispatches`,
    {
      method: "POST",
      headers: { ...githubHeaders(config.token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: config.ref, inputs }),
    }
  );
  if (!res.ok) {
    // GitHub's response body is raw/English (and sometimes a JSON blob) —
    // log it for debugging but never show it to the user; the UI only ever
    // gets a short, generic Czech message (see api/scrape/route.ts's POST).
    const text = await res.text().catch(() => "");
    console.warn(`[scrape-trigger] GitHub dispatch failed (${res.status}):`, text);
    return { ok: false, status: res.status, message: "Spuštění přes GitHub se nezdařilo." };
  }
  return { ok: true };
}

/**
 * Best-effort auto-trigger used by the instant-rematch server action (task
 * D): fires a scrape only when GITHUB_DISPATCH_TOKEN is configured AND no
 * run is currently queued/in_progress (so saving several searches in a row
 * doesn't spam duplicate workflow runs). Never throws — a dispatch failure
 * here shouldn't block the search save/rematch that triggered it.
 */
export async function maybeAutoTriggerScrape(): Promise<{ triggered: boolean }> {
  const config = githubConfig();
  if (!config) return { triggered: false };
  try {
    const latest = await getLatestScrapeRun(config);
    if (latest && (latest.status === "queued" || latest.status === "in_progress")) {
      return { triggered: false };
    }
    const result = await dispatchScrape(config);
    return { triggered: result.ok };
  } catch {
    return { triggered: false };
  }
}

/** True if a workflow run is currently queued/in progress (shared by the
 * manual-trigger guard below and the UI's own polling logic). */
export function isRunActive(run: WorkflowRunStatus | null): boolean {
  return run?.status === "queued" || run?.status === "in_progress";
}

/** HH:MM in Czech, Europe/Prague local time — used in the Czech rate-limit
 * message ("Další ruční spuštění bude možné v HH:MM."). */
function formatHHMM(iso: string): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague",
  }).format(new Date(iso));
}

/**
 * The next time a manual run is allowed for a user, given their last manual
 * request's timestamp — `null` if there's no cooldown in effect right now
 * (no previous request, or MANUAL_SCRAPE_COOLDOWN_HOURS has already
 * elapsed). `now` is injectable for tests.
 */
export function computeNextAllowedAt(lastRequestAt: string | null, now: Date = new Date()): string | null {
  if (!lastRequestAt) return null;
  const nextAllowed = new Date(
    new Date(lastRequestAt).getTime() + MANUAL_SCRAPE_COOLDOWN_HOURS * 60 * 60 * 1000
  );
  return nextAllowed.getTime() > now.getTime() ? nextAllowed.toISOString() : null;
}

export type ManualTriggerDecision =
  | { allowed: true }
  | { allowed: false; status: 409; message: string }
  | { allowed: false; status: 429; message: string; nextAllowedAt: string };

/**
 * Pure decision function for the manual "Spustit scraping mých hledání"
 * button's server-side guard (apps/web/app/api/scrape/route.ts's POST) —
 * unit tested in isolation (see scrape-trigger.server.test.ts). Two
 * independent rules, checked in order:
 *
 *   1. A workflow run already queued/in_progress -> refuse (409), so runs
 *      never pile up.
 *   2. This user's last manual request was less than
 *      MANUAL_SCRAPE_COOLDOWN_HOURS ago -> refuse (429), with the Czech
 *      message naming exactly when it'll next be allowed.
 *
 * Otherwise the trigger is allowed (the caller then records a new
 * manual_scrape_requests row and dispatches).
 */
export function decideManualScrapeTrigger(input: {
  latestRun: WorkflowRunStatus | null;
  lastRequestAt: string | null;
  now?: Date;
}): ManualTriggerDecision {
  const now = input.now ?? new Date();

  if (isRunActive(input.latestRun)) {
    return { allowed: false, status: 409, message: "Scraping už běží, počkej na dokončení." };
  }

  const nextAllowedAt = computeNextAllowedAt(input.lastRequestAt, now);
  if (nextAllowedAt) {
    return {
      allowed: false,
      status: 429,
      message: `Další ruční spuštění bude možné v ${formatHHMM(nextAllowedAt)}.`,
      nextAllowedAt,
    };
  }

  return { allowed: true };
}

/** The signed-in user's own last manual-trigger timestamp, or `null` if
 * they've never triggered one — RLS on `manual_scrape_requests` already
 * restricts this to their own rows; the explicit `.eq` is defense in depth,
 * not load-bearing. */
export async function getLastManualRequestAt(supabase: Db, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("manual_scrape_requests")
    .select("requested_at")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[scrape-trigger] failed to read last manual request:", error.message);
    return null;
  }
  return data?.requested_at ?? null;
}

/** Records a manual trigger for rate-limiting purposes (see
 * decideManualScrapeTrigger) — call only once the trigger has been decided
 * as allowed. */
export async function recordManualScrapeRequest(
  supabase: Db,
  userId: string,
  source: string | undefined
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from("manual_scrape_requests")
    .insert({ user_id: userId, source: source ?? null });
  if (error) {
    // Supabase's error text is raw/English — log it for debugging but never
    // show it to the user (see api/scrape/route.ts's POST).
    console.warn("[scrape-trigger] failed to record manual request:", error.message);
    return { ok: false, message: "Uložení požadavku se nezdařilo." };
  }
  return { ok: true };
}
