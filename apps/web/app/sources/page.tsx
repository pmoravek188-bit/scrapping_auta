import clsx from "clsx";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { ScrapeTrigger } from "@/components/scrape-trigger";
import { NotificationsToggle } from "@/components/notifications-toggle";
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
      // A manual, user-scoped run (tagged with user_id — see
      // packages/scrapers/src/runner.ts's RunOptions.userFilter) only ever
      // covers one user's searches, so it's excluded from this history
      // table, which is meant to reflect each source's full-run status.
      .is("user_id", null)
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  const enabledSources = (sources ?? []).filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stav zdrojů</h1>
          <p className="text-sm text-gray-500">Kdy který bazar naposledy fungoval a co vrátil.</p>
        </div>
        <ScrapeTrigger sources={enabledSources} />
      </div>

      <div className="card space-y-2">
        <h2 className="section-title">Notifikace</h2>
        <p className="text-sm text-gray-500">
          Push notifikace do tohoto prohlížeče/zařízení — nová auta, zlevnění oblíbených a výpadky zdrojů.
        </p>
        <NotificationsToggle />
      </div>

      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Zdroj</th>
              <th className="py-2 pr-4 font-medium">Zapnuto</th>
              <th className="py-2 pr-4 font-medium">Poslední běh</th>
              <th className="py-2 pr-4 font-medium">Poslední úspěch</th>
              <th className="py-2 pr-4 font-medium">Poslední počet</th>
            </tr>
          </thead>
          <tbody>
            {(sources ?? []).map((s) => (
              <tr key={s.id} className="border-b border-gray-50 last:border-0">
                <td className="py-2 pr-4 font-medium text-gray-900">{s.name}</td>
                <td className="py-2 pr-4">
                  <span
                    className={clsx(
                      "badge",
                      s.enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                    )}
                  >
                    {s.enabled ? "ano" : "ne"}
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-600">{formatDateTime(s.last_run_at) || "—"}</td>
                <td className="py-2 pr-4 text-gray-600">{formatDateTime(s.last_ok_at) || "—"}</td>
                <td className="py-2 pr-4 text-gray-600">{s.last_count ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 section-title">Poslední běhy scraperu</h2>
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Zdroj</th>
                <th className="py-2 pr-4 font-medium">Start</th>
                <th className="py-2 pr-4 font-medium">Nalezeno</th>
                <th className="py-2 pr-4 font-medium">Nových</th>
                <th className="py-2 pr-4 font-medium">Chyba</th>
              </tr>
            </thead>
            <tbody>
              {(runs ?? []).map((r) => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 pr-4 text-gray-900">{r.source}</td>
                  <td className="py-2 pr-4 text-gray-600">{formatDateTime(r.started_at)}</td>
                  <td className="py-2 pr-4 text-gray-600">{r.found}</td>
                  <td className="py-2 pr-4 text-gray-600">{r.new}</td>
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
