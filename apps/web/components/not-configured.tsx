import { AlertTriangle } from "lucide-react";

export function NotConfigured() {
  return (
    <div className="card flex items-start gap-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" aria-hidden />
      <div>
        <h1 className="mb-1 text-lg font-semibold text-gray-900">Aplikace není nakonfigurovaná</h1>
        <p className="text-sm text-gray-600">
          Chybí proměnné prostředí <code>NEXT_PUBLIC_SUPABASE_URL</code> a{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Nastavte je v prostředí nasazení (Vercel) a
          znovu načtěte stránku.
        </p>
      </div>
    </div>
  );
}
