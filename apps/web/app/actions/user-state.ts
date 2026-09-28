"use server";

/**
 * Task F: "NOVÉ" badge bookkeeping. `public.user_state` (owner-only RLS,
 * see supabase/migrations/20260928200000_results_rework.sql) holds a single
 * row per user with two timestamps:
 *   - results_seen_prev: the watermark a listing/match is compared against
 *     to decide if it's "NOVÉ" (first_seen / matched_at > results_seen_prev).
 *   - results_seen_at: when the current browsing session started, used only
 *     to decide when to roll results_seen_prev forward.
 *
 * Rolling forward only after 30 minutes of inactivity (rather than on every
 * visit) means badges persist through a single browsing session instead of
 * disappearing the moment you look away and come back.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SESSION_GAP_MS = 30 * 60 * 1000;

export interface SeenState {
  seenPrev: string | null;
}

/** Call on every /results visit (server component). Returns the watermark
 * to render "NOVÉ" badges against (the value BEFORE this visit's update, so
 * items that just became visible in this very visit still show as new). */
export async function touchResultsSeen(): Promise<SeenState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { seenPrev: null };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { seenPrev: null };

  const { data: existing } = await supabase
    .from("user_state")
    .select("results_seen_at, results_seen_prev")
    .eq("user_id", user.id)
    .maybeSingle();

  const now = new Date();
  const nowIso = now.toISOString();

  if (!existing) {
    // First-ever visit: nothing is "new" yet (there's no meaningful
    // watermark to compare against), so seed both timestamps to now and
    // report null (renders no NOVÉ badges this visit).
    await supabase.from("user_state").insert({
      user_id: user.id,
      results_seen_at: nowIso,
      results_seen_prev: nowIso,
    });
    return { seenPrev: null };
  }

  const seenAt = existing.results_seen_at ? new Date(existing.results_seen_at) : null;
  const gapExceeded = !seenAt || now.getTime() - seenAt.getTime() > SESSION_GAP_MS;

  if (gapExceeded) {
    const prevForThisVisit = existing.results_seen_at ?? nowIso;
    await supabase
      .from("user_state")
      .update({ results_seen_prev: prevForThisVisit, results_seen_at: nowIso })
      .eq("user_id", user.id);
    return { seenPrev: existing.results_seen_prev };
  }

  // Still within the same browsing session — leave the watermark alone so
  // badges don't flicker off between page loads.
  return { seenPrev: existing.results_seen_prev };
}

/** "Označit vše jako viděné" button: collapses both timestamps to now, so
 * every currently-new item stops being new immediately. */
export async function markAllSeenNow(): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const nowIso = new Date().toISOString();
  await supabase
    .from("user_state")
    .upsert({ user_id: user.id, results_seen_at: nowIso, results_seen_prev: nowIso });
  return { ok: true };
}
