import clsx from "clsx";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { ScrapeTrigger } from "@/components/scrape-trigger";
import { NotificationsToggle } from "@/components/notifications-toggle";
import { ScrapeStatusDisplay } from "@/components/scrape-status-badge";
import { formatDateTime } from "@/lib/format";
import { getScrapeStatus } from "@/lib/scrape-status";

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

  // `sources` itself only carries last_run_at/last_ok_at/last_count, not the
  // raw error text from that run — so each source's status badge below
  // reads the friendly-parsed `errors` off its most recent row in `runs`
  // (first occurrence per source, since `runs` is ordered newest-first).
  const latestRunBySource = new Map<string, { errors: string | null }>();
  for (const r of runs ?? []) {
    if (!latestRunBySource.has(r.source)) latestRunBySource.set(r.source, { errors: r.errors });
  }

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
              <th className="py-2 pr-4 font-medium">Poslední počet</th>
              <th className="py-2 pr-4 font-medium">Stav</th>
            </tr>
          </thead>
          <tbody>
            {(sources ?? []).map((s) => {
              const status = getScrapeStatus(latestRunBySource.get(s.id)?.errors ?? null);
              return (
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
                  <td className="py-2 pr-4 text-gray-600">{s.last_count ?? "—"}</td>
                  <td className="max-w-[16rem] py-2 pr-4 align-top">
                    <ScrapeStatusDisplay status={status} raw={latestRunBySource.get(s.id)?.errors} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 section-title">Poslední běhy scraperu</h2>
        <div className="card divide-y divide-gray-50">
          {(runs ?? []).length === 0 && <p className="py-2 text-sm text-gray-500">Žádné běhy zatím.</p>}
          {(runs ?? []).map((r) => {
            const status = getScrapeStatus(r.errors);
            return (
              <div key={r.id} className="py-2 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-600">
                  <span className="font-medium text-gray-900">{r.source}</span>
                  <span>·</span>
                  <span>{formatDateTime(r.started_at)}</span>
                  <span>·</span>
                  <span>
                    nalezeno {r.found}, nových {r.new}
                  </span>
                </div>
                <div className="mt-1">
                  <ScrapeStatusDisplay status={status} raw={r.errors} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
