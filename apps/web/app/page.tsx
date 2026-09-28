import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { CarCard } from "@/components/car-card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: matches } = await supabase
    .from("matches")
    .select("id, matched_at, status, searches(id, name), listings(*)")
    .neq("status", "hidden")
    .order("matched_at", { ascending: false })
    .limit(30);

  const rows = (matches ?? []) as unknown as Array<{
    id: string;
    matched_at: string;
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
      location: string | null;
      image_urls: string[];
    } | null;
  }>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Nejnovější nabídky</h1>
        <Link href="/searches" className="btn-secondary">
          Spravovat hledání
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-600">
          Zatím žádné shody. Vytvořte si{" "}
          <Link href="/searches/new" className="text-brand-600 underline">
            nové hledání
          </Link>
          , scraper je vyhodnotí při dalším běhu.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows
            .filter((r) => r.listings)
            .map((r) => (
              <div key={r.id}>
                {r.searches && (
                  <div className="mb-1 text-xs font-medium text-gray-400">{r.searches.name}</div>
                )}
                <CarCard listing={r.listings!} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
