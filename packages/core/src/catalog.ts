/**
 * Curated make/model catalog used by the web UI to render "click, don't
 * type" select dropdowns for the search filters, before enough listings
 * have been scraped to populate `public.make_models`.
 *
 * Slugs here MUST match what `normalizeMake`/`normalizeModel` (make-model.ts)
 * would produce for the same car, so that a search saved with these values
 * still matches listings normalized by the scraper.
 */
import { normalizeMake, normalizeModel } from "./make-model.js";

export interface MakeOption {
  slug: string;
  label: string;
}

export interface ModelOption {
  slug: string;
  label: string;
}

/** Common makes seen on the Czech used-car market (EU + a few Asian/US brands). */
const RAW_MAKES: MakeOption[] = [
  { slug: "skoda", label: "Škoda" },
  { slug: "volkswagen", label: "Volkswagen" },
  { slug: "bmw", label: "BMW" },
  { slug: "mercedes-benz", label: "Mercedes-Benz" },
  { slug: "audi", label: "Audi" },
  { slug: "ford", label: "Ford" },
  { slug: "opel", label: "Opel" },
  { slug: "seat", label: "Seat" },
  { slug: "hyundai", label: "Hyundai" },
  { slug: "kia", label: "Kia" },
  { slug: "toyota", label: "Toyota" },
  { slug: "renault", label: "Renault" },
  { slug: "peugeot", label: "Peugeot" },
  { slug: "citroen", label: "Citroën" },
  { slug: "fiat", label: "Fiat" },
  { slug: "volvo", label: "Volvo" },
  { slug: "mazda", label: "Mazda" },
  { slug: "nissan", label: "Nissan" },
  { slug: "honda", label: "Honda" },
  { slug: "mitsubishi", label: "Mitsubishi" },
  { slug: "suzuki", label: "Suzuki" },
  { slug: "dacia", label: "Dacia" },
  { slug: "jeep", label: "Jeep" },
  { slug: "mini", label: "Mini" },
  { slug: "land-rover", label: "Land Rover" },
  { slug: "porsche", label: "Porsche" },
  { slug: "tesla", label: "Tesla" },
  { slug: "alfa-romeo", label: "Alfa Romeo" },
  { slug: "lexus", label: "Lexus" },
  { slug: "subaru", label: "Subaru" },
  { slug: "chevrolet", label: "Chevrolet" },
];

export const MAKES: MakeOption[] = RAW_MAKES.map((m) => ({
  slug: normalizeMake(m.slug) ?? m.slug,
  label: m.label,
})).sort((a, b) => a.label.localeCompare(b.label, "cs"));

function models(makeSlug: string, pairs: [string, string][]): ModelOption[] {
  return pairs.map(([slug, label]) => ({
    slug: normalizeModel(slug) ?? slug,
    label,
  }));
}

/** Small static fallback of popular models per make, so the model dropdown
 * isn't empty before the scraper has found any listings for a make. */
export const POPULAR_MODELS: Record<string, ModelOption[]> = {
  skoda: models("skoda", [
    ["octavia", "Octavia"],
    ["fabia", "Fabia"],
    ["superb", "Superb"],
    ["kodiaq", "Kodiaq"],
    ["karoq", "Karoq"],
    ["scala", "Scala"],
    ["kamiq", "Kamiq"],
    ["rapid", "Rapid"],
    ["yeti", "Yeti"],
    ["citigo", "Citigo"],
    ["enyaq", "Enyaq"],
  ]),
  volkswagen: models("volkswagen", [
    ["golf", "Golf"],
    ["passat", "Passat"],
    ["polo", "Polo"],
    ["tiguan", "Tiguan"],
    ["touran", "Touran"],
    ["t-roc", "T-Roc"],
    ["up", "Up!"],
    ["arteon", "Arteon"],
    ["sharan", "Sharan"],
    ["caddy", "Caddy"],
    ["transporter", "Transporter"],
  ]),
  bmw: models("bmw", [
    ["1-series", "Řada 1"],
    ["2-series", "Řada 2"],
    ["3-series", "Řada 3"],
    ["4-series", "Řada 4"],
    ["5-series", "Řada 5"],
    ["x1", "X1"],
    ["x3", "X3"],
    ["x5", "X5"],
  ]),
  "mercedes-benz": models("mercedes-benz", [
    ["a-class", "Třída A"],
    ["b-class", "Třída B"],
    ["c-class", "Třída C"],
    ["e-class", "Třída E"],
    ["glc", "GLC"],
    ["gla", "GLA"],
    ["vito", "Vito"],
  ]),
  audi: models("audi", [
    ["a3", "A3"],
    ["a4", "A4"],
    ["a5", "A5"],
    ["a6", "A6"],
    ["q3", "Q3"],
    ["q5", "Q5"],
    ["q7", "Q7"],
  ]),
  ford: models("ford", [
    ["fiesta", "Fiesta"],
    ["focus", "Focus"],
    ["mondeo", "Mondeo"],
    ["kuga", "Kuga"],
    ["puma", "Puma"],
    ["transit", "Transit"],
    ["s-max", "S-Max"],
  ]),
  opel: models("opel", [
    ["astra", "Astra"],
    ["corsa", "Corsa"],
    ["insignia", "Insignia"],
    ["mokka", "Mokka"],
    ["zafira", "Zafira"],
    ["meriva", "Meriva"],
  ]),
  seat: models("seat", [
    ["ibiza", "Ibiza"],
    ["leon", "Leon"],
    ["ateca", "Ateca"],
    ["arona", "Arona"],
    ["alhambra", "Alhambra"],
  ]),
  hyundai: models("hyundai", [
    ["i20", "i20"],
    ["i30", "i30"],
    ["tucson", "Tucson"],
    ["santa-fe", "Santa Fe"],
    ["kona", "Kona"],
  ]),
  kia: models("kia", [
    ["ceed", "Ceed"],
    ["sportage", "Sportage"],
    ["rio", "Rio"],
    ["sorento", "Sorento"],
    ["picanto", "Picanto"],
  ]),
  toyota: models("toyota", [
    ["yaris", "Yaris"],
    ["corolla", "Corolla"],
    ["rav4", "RAV4"],
    ["aygo", "Aygo"],
    ["auris", "Auris"],
    ["avensis", "Avensis"],
  ]),
  renault: models("renault", [
    ["clio", "Clio"],
    ["megane", "Megane"],
    ["captur", "Captur"],
    ["scenic", "Scenic"],
    ["kadjar", "Kadjar"],
  ]),
  peugeot: models("peugeot", [
    ["208", "208"],
    ["308", "308"],
    ["2008", "2008"],
    ["3008", "3008"],
    ["508", "508"],
  ]),
  citroen: models("citroen", [
    ["c3", "C3"],
    ["c4", "C4"],
    ["c5", "C5"],
    ["berlingo", "Berlingo"],
  ]),
  fiat: models("fiat", [
    ["500", "500"],
    ["panda", "Panda"],
    ["tipo", "Tipo"],
    ["punto", "Punto"],
  ]),
  volvo: models("volvo", [
    ["v40", "V40"],
    ["v60", "V60"],
    ["v90", "V90"],
    ["xc60", "XC60"],
    ["xc90", "XC90"],
  ]),
  mazda: models("mazda", [
    ["mazda2", "Mazda2"],
    ["mazda3", "Mazda3"],
    ["mazda6", "Mazda6"],
    ["cx-5", "CX-5"],
  ]),
  nissan: models("nissan", [
    ["qashqai", "Qashqai"],
    ["juke", "Juke"],
    ["micra", "Micra"],
    ["x-trail", "X-Trail"],
  ]),
  honda: models("honda", [
    ["civic", "Civic"],
    ["cr-v", "CR-V"],
    ["jazz", "Jazz"],
  ]),
  mitsubishi: models("mitsubishi", [
    ["outlander", "Outlander"],
    ["asx", "ASX"],
    ["lancer", "Lancer"],
  ]),
  suzuki: models("suzuki", [
    ["swift", "Swift"],
    ["vitara", "Vitara"],
    ["sx4", "SX4"],
  ]),
  dacia: models("dacia", [
    ["duster", "Duster"],
    ["sandero", "Sandero"],
    ["logan", "Logan"],
  ]),
  jeep: models("jeep", [
    ["renegade", "Renegade"],
    ["compass", "Compass"],
    ["grand-cherokee", "Grand Cherokee"],
  ]),
  mini: models("mini", [
    ["cooper", "Cooper"],
    ["countryman", "Countryman"],
  ]),
  "land-rover": models("land-rover", [
    ["discovery", "Discovery"],
    ["range-rover", "Range Rover"],
    ["defender", "Defender"],
  ]),
  porsche: models("porsche", [
    ["911", "911"],
    ["cayenne", "Cayenne"],
    ["macan", "Macan"],
    ["panamera", "Panamera"],
  ]),
  tesla: models("tesla", [
    ["model-3", "Model 3"],
    ["model-s", "Model S"],
    ["model-x", "Model X"],
    ["model-y", "Model Y"],
  ]),
  "alfa-romeo": models("alfa-romeo", [
    ["giulia", "Giulia"],
    ["giulietta", "Giulietta"],
    ["stelvio", "Stelvio"],
  ]),
  lexus: models("lexus", [
    ["is", "IS"],
    ["rx", "RX"],
    ["nx", "NX"],
  ]),
  subaru: models("subaru", [
    ["forester", "Forester"],
    ["outback", "Outback"],
    ["impreza", "Impreza"],
  ]),
  chevrolet: models("chevrolet", [
    ["aveo", "Aveo"],
    ["cruze", "Cruze"],
    ["spark", "Spark"],
  ]),
};

/** Best-effort "prettify" of a model slug we don't have a curated label for
 * (e.g. one discovered from `public.make_models` that isn't in the static list
 * above), turning "grand-cherokee" into "Grand Cherokee". */
export function prettifyModelSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

export interface MakeModelDbRow {
  make: string | null;
  model: string | null;
  listing_count: number | null;
}

/** Merges the static fallback list with makes/models actually seen in the
 * database (from the `public.make_models` view), so the dropdown always has
 * useful entries but also reflects what has actually been scraped. */
export function mergeMakeModelCatalog(
  dbRows: MakeModelDbRow[]
): Record<string, ModelOption[]> {
  const result: Record<string, Map<string, ModelOption>> = {};

  for (const [make, list] of Object.entries(POPULAR_MODELS)) {
    result[make] = new Map(list.map((m) => [m.slug, m]));
  }

  for (const row of dbRows) {
    const make = normalizeMake(row.make);
    const model = normalizeModel(row.model);
    if (!make || !model) continue;
    if (!result[make]) result[make] = new Map();
    if (!result[make]!.has(model)) {
      result[make]!.set(model, { slug: model, label: prettifyModelSlug(model) });
    }
  }

  const out: Record<string, ModelOption[]> = {};
  for (const [make, map] of Object.entries(result)) {
    out[make] = [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "cs"));
  }
  return out;
}

/** All makes: the curated list plus any extra makes only seen in the DB. */
export function mergeMakes(dbRows: MakeModelDbRow[]): MakeOption[] {
  const bySlug = new Map(MAKES.map((m) => [m.slug, m]));
  for (const row of dbRows) {
    const slug = normalizeMake(row.make);
    if (!slug || bySlug.has(slug)) continue;
    bySlug.set(slug, { slug, label: prettifyModelSlug(slug) });
  }
  return [...bySlug.values()].sort((a, b) => a.label.localeCompare(b.label, "cs"));
}
