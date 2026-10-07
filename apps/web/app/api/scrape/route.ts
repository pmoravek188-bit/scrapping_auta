import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { githubConfig, getLatestScrapeRun, dispatchScrape } from "@/lib/scrape-trigger.server";

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
  return { user };
}

/** GET: status of the latest scrape workflow run. */
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const config = githubConfig();
  if (!config) {
    return NextResponse.json({ configured: false });
  }

  const run = await getLatestScrapeRun(config);
  if (run === null) {
    // getLatestScrapeRun returns null both for "no runs yet" and for a
    // non-ok GitHub API response; either way there's nothing actionable to
    // report back beyond "configured, nothing to show".
    return NextResponse.json({ configured: true, run: null });
  }

  return NextResponse.json({
    configured: true,
    run: {
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      html_url: run.html_url,
    },
  });
}

/** POST: trigger a scrape run via workflow_dispatch, optionally for one source. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

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

  const result = await dispatchScrape(config, source);
  if (!result.ok) {
    return NextResponse.json({ error: "dispatch_failed", message: result.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
