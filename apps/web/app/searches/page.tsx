import Link from "next/link";
import { Plus } from "lucide-react";
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
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Moje hledání</h1>
          <p className="text-sm text-gray-500">Uložené filtry, podle kterých scraper hlídá nové nabídky.</p>
        </div>
        <Link href="/searches/new" className="btn">
          <Plus className="h-4 w-4" aria-hidden />
          Nové hledání
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
