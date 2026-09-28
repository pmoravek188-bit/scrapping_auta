import { notFound } from "next/navigation";
import { mergeMakeModelCatalog, mergeMakes, normalizeMake, normalizeModel } from "@scrapping-auta/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { SearchForm, type SearchFormValues } from "@/components/search-form";

export const dynamic = "force-dynamic";

export default async function EditSearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: search }, { data: sources }, { data: makeModelRows }] = await Promise.all([
    supabase.from("searches").select("*").eq("id", id).maybeSingle(),
    supabase.from("sources").select("id, name").eq("enabled", true).order("name"),
    supabase.from("make_models").select("make, model, listing_count"),
  ]);

  if (!search) notFound();

  const initial: SearchFormValues = {
    id: search.id,
    name: search.name,
    // Legacy free-text saves (before filters became selects) could contain
    // untrimmed/unnormalized values (e.g. "ford ", "tourneo custom") that
    // wouldn't match any option or the scraper's normalized listings —
    // normalize on load so the select pre-selects correctly and re-saving
    // fixes the stored row too.
    make: normalizeMake(search.make) ?? "",
    model: normalizeModel(search.model) ?? "",
    year_from: search.year_from?.toString() ?? "",
    year_to: search.year_to?.toString() ?? "",
    price_from: search.price_from?.toString() ?? "",
    price_to: search.price_to?.toString() ?? "",
    mileage_max: search.mileage_max?.toString() ?? "",
    fuel: (search.fuel ?? []) as SearchFormValues["fuel"],
    transmission: (search.transmission ?? "") as SearchFormValues["transmission"],
    body: (search.body ?? []) as SearchFormValues["body"],
    power_min_kw: search.power_min_kw?.toString() ?? "",
    keywords: (search.keywords ?? []).join(", "),
    exclude_keywords: (search.exclude_keywords ?? []).join(", "),
    sources: search.sources ?? [],
    drive: (search.drive ?? []) as SearchFormValues["drive"],
    features: search.features ?? [],
    notify: search.notify,
    enabled: search.enabled,
  };

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Upravit hledání</h1>
      <SearchForm
        initial={initial}
        availableSources={sources ?? []}
        makes={mergeMakes(makeModelRows ?? [])}
        makeModels={mergeMakeModelCatalog(makeModelRows ?? [])}
      />
    </div>
  );
}
