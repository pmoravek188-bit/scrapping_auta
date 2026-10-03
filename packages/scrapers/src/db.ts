import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@scrapping-auta/core";

/** Shared Supabase client type/factory, split out of runner.ts so other
 * modules (push.ts, health-alert.ts, favorites-alert.ts) can depend on it
 * without creating a circular import back through runner.ts. Re-exported
 * from runner.ts for backward compatibility (existing tests import
 * `DbClient`/`createSupabaseClient` from "../src/runner.js"). */
export type DbClient = SupabaseClient<Database>;

export function createSupabaseClient(url: string, serviceRoleKey: string): DbClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
