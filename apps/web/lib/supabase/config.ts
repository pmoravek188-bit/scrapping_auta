/**
 * Reads Supabase config from env at runtime. Deliberately does NOT throw at
 * module load time so `next build` succeeds without real env vars set — see
 * README. Callers should check `isSupabaseConfigured()` and render a helpful
 * message instead of calling the client when it's false.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}
