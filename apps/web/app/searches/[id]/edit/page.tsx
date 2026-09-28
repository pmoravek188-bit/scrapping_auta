import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotConfigured } from "@/components/not-configured";
import { SearchForm, type SearchFormValues } from "@/components/search-form";

export const dynamic = "force-dynamic";

export default async function EditSearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <NotConfigured />;

  const [{ data: search }, { data: sources }] = await Promise.all([
    supabase.from("searches").select("*").eq("id", id).maybeSingle(),
    supabase.from("sources").select("id, name").eq("enabled", true),
  ]);

  if (!search) notFound();

  const initial: SearchFormValues = {
    id: search.id,
    name: search.name,
    make: search.make ?? "",
    model: search.model ?? "",
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
    notify: search.notify,
    enabled: search.enabled,
  };

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Upravit hledání</h1>
      <SearchForm initial={initial} availableSources={sources ?? []} />
    </div>
  );
}
