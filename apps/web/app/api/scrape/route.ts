import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  githubConfig,
  getLatestScrapeRun,
  dispatchScrape,
  decideManualScrapeTrigger,
  computeNextAllowedAt,
  getLastManualRequestAt,
  recordManualScrapeRequest,
} from "@/lib/scrape-trigger.server";

export const dynamic = "force-dynamic";

/**
 * NOTE: the middleware matcher excludes paths starting with "api" (see
 * apps/web/middleware.ts), so this route is NOT protected by the middleware
 * redirect — the auth check below is the only thing guarding it.
 */
async function requireUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: NextResponse.json({ error: "not_configured" }, { status: 500 }) };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { user, supabase };
}

/** GET: status of the latest scrape workflow run, plus when the current
 * user is next allowed to trigger a manual run (see
 * decideManualScrapeTrigger). */
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const config = githubConfig();
  if (!config) {
    return NextResponse.json({ configured: false });
  }

  const [run, lastRequestAt] = await Promise.all([
    getLatestScrapeRun(config),
    getLastManualRequestAt(auth.supabase, auth.user.id),
  ]);
  const nextAllowedAt = computeNextAllowedAt(lastRequestAt);

  if (run === null) {
    // getLatestScrapeRun returns null both for "no runs yet" and for a
    // non-ok GitHub API response; either way there's nothing actionable to
    // report back beyond "configured, nothing to show".
    return NextResponse.json({ configured: true, run: null, nextAllowedAt });
  }

  return NextResponse.json({
    configured: true,
    run: {
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      html_url: run.html_url,
    },
    nextAllowedAt,
  });
}

/**
 * POST: trigger a scrape run via workflow_dispatch, scoped to the signed-in
 * user's own searches only, optionally for one source.
 *
 * Product decision: a manual run from this button only ever processes and
 * notifies the CLICKING user (never trusts a client-supplied user id — the
 * `user_id` dispatched below always comes from the authenticated session),
 * plus server-side rate limiting (see decideManualScrapeTrigger): refuses
 * with 409 while a run is already queued/in_progress (no piling up), and
 * 429 if this user triggered one less than MANUAL_SCRAPE_COOLDOWN_HOURS ago.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const config = githubConfig();
  if (!config) {
    return NextResponse.json(
      { error: "not_configured", message: "Chybí GITHUB_DISPATCH_TOKEN ve Vercelu." },
      { status: 500 }
    );
  }

  let source: string | undefined;
  try {
    const body = (await request.json()) as { source?: string };
    source = body?.source || undefined;
  } catch {
    // no body sent — run all sources
  }

  const [latestRun, lastRequestAt] = await Promise.all([
    getLatestScrapeRun(config),
    getLastManualRequestAt(supabase, user.id),
  ]);

  const decision = decideManualScrapeTrigger({ latestRun, lastRequestAt });
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: decision.status === 409 ? "already_running" : "rate_limited",
        message: decision.message,
        ...(decision.status === 429 ? { nextAllowedAt: decision.nextAllowedAt } : {}),
      },
      { status: decision.status }
    );
  }

  const recorded = await recordManualScrapeRequest(supabase, user.id, source);
  if (!recorded.ok) {
    return NextResponse.json({ error: "db_error", message: recorded.message }, { status: 500 });
  }

  const result = await dispatchScrape(config, source, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: "dispatch_failed", message: result.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
