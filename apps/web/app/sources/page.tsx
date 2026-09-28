import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: sources }, { data: runs }] = await Promise.all([
    supabase.from("sources").select("*").order("id"),
    supabase
      .from("scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Stav zdrojů</h1>

      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4">Zdroj</th>
              <th className="py-2 pr-4">Zapnuto</th>
              <th className="py-2 pr-4">Poslední běh</th>
              <th className="py-2 pr-4">Poslední úspěch</th>
              <th className="py-2 pr-4">Poslední počet</th>
            </tr>
          </thead>
          <tbody>
            {(sources ?? []).map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="py-2 pr-4 font-medium">{s.name}</td>
                <td className="py-2 pr-4">{s.enabled ? "ano" : "ne"}</td>
                <td className="py-2 pr-4">{formatDateTime(s.last_run_at) || "—"}</td>
                <td className="py-2 pr-4">{formatDateTime(s.last_ok_at) || "—"}</td>
                <td className="py-2 pr-4">{s.last_count ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Poslední běhy scraperu</h2>
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-4">Zdroj</th>
                <th className="py-2 pr-4">Start</th>
                <th className="py-2 pr-4">Nalezeno</th>
                <th className="py-2 pr-4">Nových</th>
                <th className="py-2 pr-4">Chyba</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{r.source}</td>
                  <td className="py-2 pr-4">{formatDateTime(r.started_at)}</td>
                  <td className="py-2 pr-4">{r.found}</td>
                  <td className="py-2 pr-4">{r.new}</td>
                  <td className="py-2 pr-4 text-red-600">{r.errors ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
