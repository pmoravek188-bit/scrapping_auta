export function NotConfigured() {
  return (
    <div className="card">
      <h1 className="mb-2 text-lg font-semibold">Aplikace není nakonfigurovaná</h1>
      <p className="text-sm text-gray-600">
        Chybí proměnné prostředí <code>NEXT_PUBLIC_SUPABASE_URL</code> a{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Nastavte je v prostředí nasazení (Vercel) a
        znovu načtěte stránku.
      </p>
    </div>
  );
}
