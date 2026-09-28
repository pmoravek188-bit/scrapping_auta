import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_REPO = "pmoravek188-bit/scrapping_auta";
const DEFAULT_REF = "claude/car-search-app-y4b753";

function githubConfig() {
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

  const res = await fetch(
    `https://api.github.com/repos/${config.repo}/actions/workflows/scrape.yml/runs?per_page=1`,
    { headers: githubHeaders(config.token), cache: "no-store" }
  );

  if (!res.ok) {
    return NextResponse.json(
      { configured: true, error: `GitHub API vrátilo ${res.status}` },
      { status: 502 }
    );
  }

  const data = (await res.json()) as {
    workflow_runs?: Array<{
      status: string;
      conclusion: string | null;
      created_at: string;
      html_url: string;
    }>;
  };
  const run = data.workflow_runs?.[0];

  return NextResponse.json({
    configured: true,
    run: run
      ? {
          status: run.status,
          conclusion: run.conclusion,
          created_at: run.created_at,
          html_url: run.html_url,
        }
      : null,
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

  const res = await fetch(
    `https://api.github.com/repos/${config.repo}/actions/workflows/scrape.yml/dispatches`,
    {
      method: "POST",
      headers: { ...githubHeaders(config.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: config.ref,
        inputs: source ? { source } : {},
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "dispatch_failed", message: `GitHub API vrátilo ${res.status}: ${text}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
