import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@scrapping-auta/core";
import { getSupabaseEnv } from "./config.js";

/** Server-side Supabase client bound to the current request's cookies. Returns null if not configured. */
export async function createSupabaseServerClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component without a mutable cookie jar; the
          // middleware refreshes the session instead, so this is safe to ignore.
        }
      },
    },
  });
}
