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

/** Coarse body/segment tag for a catalog model, used to power a future
 * "jen dodávky" (vans only) style filter. Optional and purely additive —
 * existing consumers that only read `slug`/`label` are unaffected. Not the
 * same enum as `BodyType` (enums.ts): this tags the *model line* (e.g. "the
 * Transit family is a van"), while `BodyType` tags an individual listing's
 * actual body shape as scraped. */
export type ModelSegment = "van" | "pickup" | "mpv";

export interface MakeOption {
  slug: string;
  label: string;
}

export interface ModelOption {
  slug: string;
  label: string;
  /** Present only for vans/pickups/MPVs added to widen commercial-vehicle
   * coverage; absent for ordinary passenger-car entries. */
  segment?: ModelSegment;
}

/** Common makes seen on the Czech used-car market (EU + a few Asian/US
 * brands), plus dedicated commercial/van/pickup makes (Iveco, MAN, Isuzu,
 * SsangYong, Maxus, LDV, Piaggio, Dodge, RAM). */
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
  { slug: "cupra", label: "Cupra" },
  // Commercial / van / pickup specialist makes.
  { slug: "iveco", label: "Iveco" },
  { slug: "man", label: "MAN" },
  { slug: "isuzu", label: "Isuzu" },
  { slug: "ssangyong", label: "SsangYong" },
  { slug: "maxus", label: "Maxus" },
  { slug: "ldv", label: "LDV" },
  { slug: "piaggio", label: "Piaggio" },
  { slug: "dodge", label: "Dodge" },
  { slug: "ram", label: "RAM" },
];

export const MAKES: MakeOption[] = RAW_MAKES.map((m) => ({
  slug: normalizeMake(m.slug) ?? m.slug,
  label: m.label,
})).sort((a, b) => a.label.localeCompare(b.label, "cs"));

/** A model tuple is `[slug, label]` or `[slug, label, segment]` when it's a
 * van/pickup/MPV worth tagging for a future body-segment filter. */
type ModelTuple = [string, string] | [string, string, ModelSegment];

function models(makeSlug: string, pairs: ModelTuple[]): ModelOption[] {
  return pairs.map(([slug, label, segment]) => ({
    slug: normalizeModel(slug) ?? slug,
    label,
    ...(segment ? { segment } : {}),
  }));
}

/** Small static fallback of popular models per make, so the model dropdown
 * isn't empty before the scraper has found any listings for a make.
 *
 * Also doubles as the model dictionary `inferMakeModel` (infer.ts) scans
 * listing titles against, so widening this list also improves make/model
 * extraction for sources that don't expose structured model fields. */
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
    ["roomster", "Roomster", "mpv"],
  ]),
  volkswagen: models("volkswagen", [
    ["golf", "Golf"],
    ["passat", "Passat"],
    ["polo", "Polo"],
    ["tiguan", "Tiguan"],
    ["touran", "Touran"],
    ["touareg", "Touareg"],
    ["t-roc", "T-Roc"],
    ["t-cross", "T-Cross"],
    ["up", "Up!"],
    ["arteon", "Arteon"],
    ["sharan", "Sharan"],
    ["id-3", "ID.3"],
    ["id-4", "ID.4"],
    ["id-5", "ID.5"],
    // Vans / MPVs / pickups.
    ["caddy", "Caddy", "van"],
    ["transporter", "Transporter", "van"],
    ["multivan", "Multivan", "mpv"],
    ["caravelle", "Caravelle", "van"],
    ["california", "California", "van"],
    ["crafter", "Crafter", "van"],
    ["amarok", "Amarok", "pickup"],
    ["id-buzz", "ID. Buzz", "van"],
  ]),
  bmw: models("bmw", [
    ["1-series", "Řada 1"],
    ["2-series", "Řada 2"],
    ["3-series", "Řada 3"],
    ["4-series", "Řada 4"],
    ["5-series", "Řada 5"],
    ["x1", "X1"],
    ["x2", "X2"],
    ["x3", "X3"],
    ["x5", "X5"],
    ["x6", "X6"],
  ]),
  "mercedes-benz": models("mercedes-benz", [
    ["a-class", "Třída A"],
    ["b-class", "Třída B"],
    ["c-class", "Třída C"],
    ["e-class", "Třída E"],
    ["glc", "GLC"],
    ["gla", "GLA"],
    // Vans / MPVs / pickups. Sources write the V-Class both as "Třída V"
    // and as "V-Klasse"/"V-Class" — normalizeModel produces different
    // slugs for each (no shared alias table), so both are catalogued.
    ["vito", "Vito", "van"],
    ["v-klasse", "Třída V (V-Klasse)", "mpv"],
    ["trida-v", "Třída V (V-Klasse)", "mpv"],
    ["viano", "Viano", "van"],
    ["sprinter", "Sprinter", "van"],
    ["citan", "Citan", "van"],
    ["t-klasse", "Třída T (T-Klasse)", "van"],
    ["eqv", "EQV", "van"],
    ["evito", "eVito", "van"],
    ["x-klasse", "Třída X (X-Class)", "pickup"],
  ]),
  audi: models("audi", [
    ["a1", "A1"],
    ["a3", "A3"],
    ["a4", "A4"],
    ["a5", "A5"],
    ["a6", "A6"],
    ["q2", "Q2"],
    ["q3", "Q3"],
    ["q5", "Q5"],
    ["q7", "Q7"],
    ["q8", "Q8"],
  ]),
  ford: models("ford", [
    ["fiesta", "Fiesta"],
    ["focus", "Focus"],
    ["mondeo", "Mondeo"],
    ["kuga", "Kuga"],
    ["puma", "Puma"],
    ["edge", "Edge"],
    ["s-max", "S-Max"],
    ["galaxy", "Galaxy", "mpv"],
    // Vans / MPVs / pickups.
    ["transit", "Transit", "van"],
    ["transit-custom", "Transit Custom", "van"],
    ["transit-connect", "Transit Connect", "van"],
    ["transit-courier", "Transit Courier", "van"],
    ["tourneo-custom", "Tourneo Custom", "mpv"],
    ["tourneo-connect", "Tourneo Connect", "mpv"],
    ["tourneo-courier", "Tourneo Courier", "mpv"],
    ["ranger", "Ranger", "pickup"],
  ]),
  opel: models("opel", [
    ["astra", "Astra"],
    ["corsa", "Corsa"],
    ["insignia", "Insignia"],
    ["mokka", "Mokka"],
    ["zafira", "Zafira"],
    ["meriva", "Meriva"],
    // Vans / MPVs.
    ["vivaro", "Vivaro", "van"],
    ["movano", "Movano", "van"],
    ["combo", "Combo", "van"],
    ["zafira-life", "Zafira Life", "mpv"],
  ]),
  seat: models("seat", [
    ["ibiza", "Ibiza"],
    ["leon", "Leon"],
    ["ateca", "Ateca"],
    ["arona", "Arona"],
    ["tarraco", "Tarraco"],
    ["alhambra", "Alhambra", "mpv"],
  ]),
  hyundai: models("hyundai", [
    ["i20", "i20"],
    ["i30", "i30"],
    ["tucson", "Tucson"],
    ["santa-fe", "Santa Fe"],
    ["kona", "Kona"],
    // Vans / MPVs.
    ["h-1", "H-1", "van"],
    ["h350", "H350", "van"],
    ["staria", "Staria", "mpv"],
  ]),
  kia: models("kia", [
    ["ceed", "Ceed"],
    ["sportage", "Sportage"],
    ["rio", "Rio"],
    ["sorento", "Sorento"],
    ["picanto", "Picanto"],
    ["carnival", "Carnival", "mpv"],
  ]),
  toyota: models("toyota", [
    ["yaris", "Yaris"],
    ["corolla", "Corolla"],
    ["rav4", "RAV4"],
    ["aygo", "Aygo"],
    ["auris", "Auris"],
    ["avensis", "Avensis"],
    // Vans / MPVs / pickups.
    ["proace", "Proace", "van"],
    ["proace-city", "Proace City", "van"],
    ["proace-verso", "Proace Verso", "mpv"],
    ["hiace", "Hiace", "van"],
    ["hilux", "Hilux", "pickup"],
  ]),
  renault: models("renault", [
    ["clio", "Clio"],
    ["megane", "Megane"],
    ["captur", "Captur"],
    ["scenic", "Scenic"],
    ["kadjar", "Kadjar"],
    ["espace", "Espace", "mpv"],
    // Vans.
    ["trafic", "Trafic", "van"],
    ["master", "Master", "van"],
    ["kangoo", "Kangoo", "van"],
    ["express", "Express", "van"],
  ]),
  peugeot: models("peugeot", [
    ["208", "208"],
    ["308", "308"],
    ["2008", "2008"],
    ["3008", "3008"],
    ["508", "508"],
    // Vans / MPVs.
    ["expert", "Expert", "van"],
    ["boxer", "Boxer", "van"],
    ["partner", "Partner", "van"],
    ["traveller", "Traveller", "mpv"],
    ["rifter", "Rifter", "mpv"],
  ]),
  citroen: models("citroen", [
    ["c3", "C3"],
    ["c4", "C4"],
    ["c5", "C5"],
    // Vans / MPVs.
    ["berlingo", "Berlingo", "van"],
    ["jumpy", "Jumpy", "van"],
    ["jumper", "Jumper", "van"],
    ["spacetourer", "SpaceTourer", "mpv"],
  ]),
  fiat: models("fiat", [
    ["500", "500"],
    ["panda", "Panda"],
    ["tipo", "Tipo"],
    ["punto", "Punto"],
    // Vans / MPVs.
    ["ducato", "Ducato", "van"],
    ["scudo", "Scudo", "van"],
    ["talento", "Talento", "van"],
    ["doblo", "Doblò", "van"],
    ["fiorino", "Fiorino", "van"],
    ["qubo", "Qubo", "mpv"],
  ]),
  volvo: models("volvo", [
    ["v40", "V40"],
    ["v60", "V60"],
    ["v90", "V90"],
    ["xc40", "XC40"],
    ["xc60", "XC60"],
    ["xc90", "XC90"],
  ]),
  mazda: models("mazda", [
    ["mazda2", "Mazda2"],
    ["mazda3", "Mazda3"],
    ["mazda6", "Mazda6"],
    ["cx-3", "CX-3"],
    ["cx-5", "CX-5"],
    ["cx-30", "CX-30"],
  ]),
  nissan: models("nissan", [
    ["qashqai", "Qashqai"],
    ["juke", "Juke"],
    ["micra", "Micra"],
    ["x-trail", "X-Trail"],
    // Vans / pickup.
    ["primastar", "Primastar", "van"],
    ["nv200", "NV200", "van"],
    ["nv300", "NV300", "van"],
    ["nv400", "NV400", "van"],
    ["interstar", "Interstar", "van"],
    ["townstar", "Townstar", "van"],
    ["navara", "Navara", "pickup"],
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
    ["l200", "L200", "pickup"],
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
    ["dokker", "Dokker", "van"],
    ["jogger", "Jogger", "mpv"],
  ]),
  jeep: models("jeep", [
    ["renegade", "Renegade"],
    ["compass", "Compass"],
    ["grand-cherokee", "Grand Cherokee"],
    ["gladiator", "Gladiator", "pickup"],
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
  cupra: models("cupra", [
    ["formentor", "Formentor"],
    ["leon", "Leon"],
    ["ateca", "Ateca"],
    ["born", "Born"],
  ]),
  // Commercial / van / pickup specialist makes.
  iveco: models("iveco", [["daily", "Daily", "van"]]),
  man: models("man", [["tge", "TGE", "van"]]),
  isuzu: models("isuzu", [["d-max", "D-Max", "pickup"]]),
  ssangyong: models("ssangyong", [
    ["musso", "Musso", "pickup"],
    ["korando", "Korando"],
    ["rexton", "Rexton"],
  ]),
  maxus: models("maxus", [
    ["deliver-9", "Deliver 9", "van"],
    ["edeliver-3", "eDeliver 3", "van"],
    ["edeliver-9", "eDeliver 9", "van"],
    ["t90", "T90", "pickup"],
  ]),
  ldv: models("ldv", [
    ["v80", "V80", "van"],
    ["g10", "G10", "van"],
  ]),
  piaggio: models("piaggio", [["porter", "Porter", "van"]]),
  dodge: models("dodge", [
    ["journey", "Journey", "mpv"],
    ["caravan", "Caravan", "mpv"],
  ]),
  ram: models("ram", [
    ["1500", "1500", "pickup"],
    ["2500", "2500", "pickup"],
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
