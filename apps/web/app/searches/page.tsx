import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { SearchListItem, type SearchRow } from "./search-list-item";

export const dynamic = "force-dynamic";

export default async function SearchesPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: searches } = await supabase
    .from("searches")
    .select("*")
    .order("created_at", { ascending: false });

  const rows = (searches ?? []) as SearchRow[];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Moje hledání</h1>
        <Link href="/searches/new" className="btn">
          + Nové hledání
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-600">Zatím nemáte žádné uložené hledání.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <SearchListItem key={s.id} search={s} />
          ))}
        </div>
      )}
    </div>
  );
}
