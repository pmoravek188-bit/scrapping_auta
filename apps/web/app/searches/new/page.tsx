import { mergeMakeModelCatalog, mergeMakes } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { SearchForm, EMPTY_SEARCH_FORM } from "@/components/search-form";

export const dynamic = "force-dynamic";

export default async function NewSearchPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: sources }, { data: makeModelRows }] = await Promise.all([
    supabase.from("sources").select("id, name").eq("enabled", true).order("name"),
    supabase.from("make_models").select("make, model, listing_count"),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Nové hledání</h1>
      <SearchForm
        initial={EMPTY_SEARCH_FORM}
        availableSources={sources ?? []}
        makes={mergeMakes(makeModelRows ?? [])}
        makeModels={mergeMakeModelCatalog(makeModelRows ?? [])}
      />
    </div>
  );
}
