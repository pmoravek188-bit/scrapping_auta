import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@scrapping-auta/core";

/**
 * "Am I an admin?" check against `public.app_admins` (see
 * supabase/migrations/20261005000000_app_admins.sql). RLS on that table only
 * lets a signed-in user see their OWN row, so this query is safe to run with
 * the normal session client — it can never be used to enumerate other
 * admins, only to answer this one yes/no question about the caller.
 *
 * Used to gate the "Spustit scraping" trigger (apps/web/app/api/scrape/route.ts,
 * apps/web/components/scrape-trigger.tsx) and to decide whether to render
 * that button at all on /sources and the home dashboard.
 */
export async function isAdmin(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return data != null;
}

/** Same check for the signed-in user of a server component; false when
 * nobody is signed in. Used to hide admin-only controls ("Spustit scraping"). */
export async function currentUserIsAdmin(supabase: SupabaseClient<Database>): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? isAdmin(supabase, user.id) : false;
}
