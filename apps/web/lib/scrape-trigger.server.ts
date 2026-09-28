/**
 * Shared server-side helper for triggering/checking the GitHub Actions
 * scrape workflow. Used by both `app/api/scrape/route.ts` (the "Spustit
 * scraping" button on /sources) and the instant-rematch server action
 * (`app/actions/rematch.ts`, task D: auto-trigger a scrape right after a
 * search is saved/updated, so newly-relevant listings show up quickly).
 */

const DEFAULT_REPO = "pmoravek188-bit/scrapping_auta";
const DEFAULT_REF = "claude/car-search-app-y4b753";

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

/** Dispatches a scrape.yml workflow_dispatch run, optionally for one source. */
export async function dispatchScrape(
  config: GithubDispatchConfig,
  source?: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${config.repo}/actions/workflows/scrape.yml/dispatches`,
    {
      method: "POST",
      headers: { ...githubHeaders(config.token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: config.ref, inputs: source ? { source } : {} }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: `GitHub API vrátilo ${res.status}: ${text}` };
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
