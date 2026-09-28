import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Only allow same-origin relative redirects (must start with "/" and not "//"). */
function safeRedirect(path: string | null): string {
  if (path && path.startsWith("/") && !path.startsWith("//")) {
    return path;
  }
  return "/";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.redirect(`${origin}/login?error=not_configured`);
  }

  let errorCode: string | null = null;

  if (tokenHash && type) {
    // Cross-browser/cross-device flow: token_hash from the email link is
    // verified directly, no PKCE code_verifier cookie required.
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      errorCode = "otp_failed";
    }
  } else if (code) {
    // Legacy PKCE flow: only works when opened in the same browser that
    // requested the magic link (the code_verifier cookie must be present).
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      errorCode = "code_exchange_failed";
    }
  } else {
    errorCode = "missing_params";
  }

  if (errorCode) {
    return NextResponse.redirect(`${origin}/login?error=${errorCode}`);
  }

  // supabase's cookies() setAll() writes onto the request's cookie jar via
  // next/headers, which Next.js applies to whatever response this route
  // handler returns — so redirecting here after the verify/exchange call
  // carries the session cookies.
  return NextResponse.redirect(`${origin}${redirectTo}`);
}
