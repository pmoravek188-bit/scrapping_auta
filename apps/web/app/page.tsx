import Link from "next/link";
import { Search } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { CarCard } from "@/components/car-card";
import { ScrapeTrigger } from "@/components/scrape-trigger";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: matches }, { data: sourceRows }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, matched_at, status, searches(id, name), listings(*)")
      .neq("status", "hidden")
      .order("matched_at", { ascending: false })
      .limit(30),
    supabase.from("sources").select("id, name").eq("enabled", true).order("name"),
  ]);

  const rows = (matches ?? []) as unknown as Array<{
    id: string;
    matched_at: string;
    status: string;
    searches: { id: string; name: string } | null;
    listings: {
      id: string;
      title: string;
      url: string;
      source: string;
      price_czk: number | null;
      year: number | null;
      mileage_km: number | null;
      fuel: string | null;
      transmission: string | null;
      power_kw: number | null;
      location: string | null;
      image_urls: string[];
    } | null;
  }>;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nejnovější nabídky</h1>
          <p className="text-sm text-gray-500">Poslední shody napříč všemi vašimi hledáními.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScrapeTrigger sources={sourceRows ?? []} />
          <Link href="/results" className="btn-secondary">
            <Search className="h-4 w-4" aria-hidden />
            Všechny výsledky
          </Link>
          <Link href="/searches" className="btn">
            Spravovat hledání
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-600">
          Zatím žádné shody. Vytvořte si{" "}
          <Link href="/searches/new" className="font-medium text-brand-600 underline">
            nové hledání
          </Link>
          , scraper je vyhodnotí při dalším běhu.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows
            .filter((r) => r.listings)
            .map((r) => (
              <div key={r.id}>
                {r.searches && (
                  <div className="mb-1.5 text-xs font-medium text-gray-400">{r.searches.name}</div>
                )}
                <CarCard listing={r.listings!} matchId={r.id} favorite={r.status === "favorite"} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
