import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { SearchForm, EMPTY_SEARCH_FORM } from "@/components/search-form";

export const dynamic = "force-dynamic";

export default async function NewSearchPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const { data: sources } = await supabase.from("sources").select("id, name").eq("enabled", true);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Nové hledání</h1>
      <SearchForm initial={EMPTY_SEARCH_FORM} availableSources={sources ?? []} />
    </div>
  );
}
