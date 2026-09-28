"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@scrapping-auta/core";
import { getSupabaseEnv } from "./config.js";

/** Browser Supabase client. Returns null if env vars are not configured. */
export function createSupabaseBrowserClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  return createBrowserClient<Database>(env.url, env.anonKey);
}
