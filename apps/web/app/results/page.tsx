import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { ResultRow, type ResultRowData } from "./result-row";

export const dynamic = "force-dynamic";

type SortKey = "newest" | "price_asc" | "price_desc" | "year_desc" | "mileage_asc";

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Nejnovější",
  price_asc: "Cena vzestupně",
  price_desc: "Cena sestupně",
  year_desc: "Nejnovější rok",
  mileage_asc: "Nejnižší nájezd",
};

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; sort?: string; status?: string }>;
}) {
  const { search: searchId, sort = "newest", status = "active" } = await searchParams;
  const sortKey = (sort as SortKey) in SORT_LABELS ? (sort as SortKey) : "newest";

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: searches } = await supabase.from("searches").select("id, name").order("created_at");

  let query = supabase
    .from("matches")
    .select("id, matched_at, status, search_id, listings(*)")
    .limit(100);

  if (searchId) query = query.eq("search_id", searchId);
  if (status === "active") query = query.neq("status", "hidden");
  if (status === "favorite") query = query.eq("status", "favorite");

  const { data: matches } = await query;

  type Row = {
    id: string;
    matched_at: string;
    status: string;
    listings: ResultRowData["listing"] | null;
  };
  let rows = ((matches ?? []) as unknown as Row[]).filter((r) => r.listings);

  rows = rows.sort((a, b) => {
    const la = a.listings!;
    const lb = b.listings!;
    switch (sortKey) {
      case "price_asc":
        return (la.price_czk ?? Infinity) - (lb.price_czk ?? Infinity);
      case "price_desc":
        return (lb.price_czk ?? -Infinity) - (la.price_czk ?? -Infinity);
      case "year_desc":
        return (lb.year ?? 0) - (la.year ?? 0);
      case "mileage_asc":
        return (la.mileage_km ?? Infinity) - (lb.mileage_km ?? Infinity);
      default:
        return new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime();
    }
  });

  // group offer counts (same group_id) among currently loaded rows, best-effort
  const groupCounts = new Map<string, number>();
  for (const r of rows) {
    const gid = r.listings?.group_id;
    if (!gid) continue;
    groupCounts.set(gid, (groupCounts.get(gid) ?? 0) + 1);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Výsledky</h1>
        <form className="flex flex-wrap gap-2 text-sm" method="get">
          {searchId && <input type="hidden" name="search" value={searchId} />}
          <select name="sort" defaultValue={sortKey} className="input w-auto">
            {Object.entries(SORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="active">Aktivní</option>
            <option value="favorite">Oblíbené</option>
            <option value="all">Vše</option>
          </select>
          <button type="submit" className="btn-secondary">
            Filtrovat
          </button>
        </form>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          href="/results"
          className={`rounded-full border px-3 py-1 ${!searchId ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300"}`}
        >
          Všechna hledání
        </Link>
        {(searches ?? []).map((s) => (
          <Link
            key={s.id}
            href={`/results?search=${s.id}`}
            className={`rounded-full border px-3 py-1 ${searchId === s.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-300"}`}
          >
            {s.name}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-600">Žádné výsledky.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <ResultRow
              key={r.id}
              matchId={r.id}
              status={r.status}
              listing={r.listings!}
              offerCount={groupCounts.get(r.listings!.group_id ?? "") ?? 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
