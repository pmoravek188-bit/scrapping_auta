/**
 * Make/model normalization: maps common aliases and diacritics variants to a
 * canonical slug so listings from different sources (and search queries) can
 * be matched reliably (e.g. "Škoda"/"skoda", "VW"/"volkswagen").
 */
import { normalizeEnumToken } from "./enums.js";

export const MAKE_ALIASES: Record<string, string> = {
  skoda: "skoda",
  "škoda": "skoda",
  vw: "volkswagen",
  volkswagen: "volkswagen",
  mb: "mercedes-benz",
  mercedes: "mercedes-benz",
  "mercedes-benz": "mercedes-benz",
  bmw: "bmw",
  audi: "audi",
  ford: "ford",
  opel: "opel",
  vauxhall: "opel",
  seat: "seat",
  hyundai: "hyundai",
  kia: "kia",
  toyota: "toyota",
  renault: "renault",
  peugeot: "peugeot",
  citroen: "citroen",
  "citroën": "citroen",
  fiat: "fiat",
  volvo: "volvo",
  mazda: "mazda",
  nissan: "nissan",
  honda: "honda",
  mitsubishi: "mitsubishi",
  suzuki: "suzuki",
  dacia: "dacia",
  jeep: "jeep",
  mini: "mini",
  landrover: "land-rover",
  "land rover": "land-rover",
  "land-rover": "land-rover",
  porsche: "porsche",
  tesla: "tesla",
  alfaromeo: "alfa-romeo",
  "alfa romeo": "alfa-romeo",
  "alfa-romeo": "alfa-romeo",
  lexus: "lexus",
  subaru: "subaru",
  chevrolet: "chevrolet",
  cupra: "cupra",
  // Commercial / van / pickup specialist makes. These are single words that
  // `slugifyMakeModel` would already turn into the same slug via
  // `normalizeMake`'s fallback path, but they still need an explicit entry
  // here: `isKnownMakeSlug` (used by tipcars to tell a real make apart from a
  // mis-parsed URL category segment) and `inferMakeModel`'s free-text make
  // scan (used by bazos/havex) both only recognize makes actually listed in
  // this table's values, not the slugify fallback.
  iveco: "iveco",
  man: "man",
  isuzu: "isuzu",
  ssangyong: "ssangyong",
  "ssang yong": "ssangyong",
  // SsangYong rebranded to "KG Mobility" (KGM) in 2023-24; some sources may
  // still spell listings under either name.
  kgm: "ssangyong",
  "kg mobility": "ssangyong",
  "kg-mobility": "ssangyong",
  maxus: "maxus",
  ldv: "ldv",
  piaggio: "piaggio",
  dodge: "dodge",
  ram: "ram",
};

/** All canonical make slugs this app knows about (the alias table's values). */
const KNOWN_MAKE_SLUGS = new Set(Object.values(MAKE_ALIASES));

/** True if `slug` is a canonical make slug we recognize (already normalized,
 * e.g. via `normalizeMake`). Used to tell a real make apart from a URL path
 * segment that only looks like one (e.g. a source's category slug). */
export function isKnownMakeSlug(slug: string | null | undefined): boolean {
  return Boolean(slug && KNOWN_MAKE_SLUGS.has(slug));
}

export function slugifyMakeModel(value: string): string {
  return normalizeEnumToken(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Normalizes a make name to its canonical slug (e.g. "Škoda" -> "skoda"). */
export function normalizeMake(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = normalizeEnumToken(value).replace(/\s+/g, " ").trim();
  if (MAKE_ALIASES[key]) return MAKE_ALIASES[key];
  const slug = slugifyMakeModel(value);
  return MAKE_ALIASES[slug] ?? slug;
}

/** Bare-letter Mercedes-Benz "class" models this app canonicalizes to
 * `${letter}-class` (Třída A/B/C/E/S/G/V/T/X). Every other Mercedes model
 * name (GLC, CLA, Vito, Sprinter, ...) is already spelled consistently
 * across sources and needs no aliasing. */
const MERCEDES_CLASS_LETTERS = new Set(["a", "b", "c", "e", "s", "g", "v", "t", "x"]);

/**
 * Rewrites an already-slugified Mercedes-Benz model string into our
 * canonical `${letter}-class[-<rest>]` form, tolerating every spelling
 * sources use for the same car:
 *   - Czech nominative: "trida-v" (Třída V)
 *   - Czech genitive: "tridy-v" (Třídy V) — confirmed live: sauto.cz's
 *     `model_cb.seo_name` and tipcars.com's URL slugs both expose every
 *     Mercedes class as "Třídy X" / "tridy-x", not "Třída X"/"trida-x"
 *   - German: "v-klasse"
 *   - English: "v-class" (already canonical; rewritten to itself so this is
 *     idempotent)
 *   - reversed order: "class-v"
 *   - a bare letter, e.g. "v" — confirmed live: aaaauto.cz's structured
 *     listing `model` field for every V-Class car is literally "V" (not
 *     "V-Class"), and its own URL model filter is likewise just "v". A bare
 *     letter is only rewritten here, inside the Mercedes-only branch of
 *     `normalizeModel` below — for every other make, a plain letter model
 *     is left untouched, since there it's genuinely ambiguous.
 * A trailing model-detail suffix (e.g. "trida-v-250") is preserved after the
 * rewritten class ("v-class-250") so `matcher.ts`'s `${query}-` prefix
 * matching still works.
 */
function applyMercedesModelAlias(slug: string): string {
  const tokens = slug.split("-").filter(Boolean);
  if (tokens.length === 0) return slug;
  const [first, second, ...rest] = tokens;

  if (tokens.length === 1 && first && MERCEDES_CLASS_LETTERS.has(first)) {
    return `${first}-class`;
  }
  if (first && second && (first === "trida" || first === "tridy") && MERCEDES_CLASS_LETTERS.has(second)) {
    return [second, "class", ...rest].join("-");
  }
  if (first && second && MERCEDES_CLASS_LETTERS.has(first) && (second === "klasse" || second === "class")) {
    return [first, "class", ...rest].join("-");
  }
  if (first === "class" && second && MERCEDES_CLASS_LETTERS.has(second)) {
    return [second, "class", ...rest].join("-");
  }
  return slug;
}

/** If `modelSlug` (as produced by `normalizeModel`) is one of the canonical
 * Mercedes-Benz "letter class" models (a-class, b-class, ..., x-class),
 * returns the bare letter; otherwise null. Exported so source adapters that
 * build enumerated model-filter URLs (sauto, autoscout24, tipcars, aaaauto,
 * carvago — see each for the source-specific slug it actually expects) can
 * translate our canonical slug back into that source's own spelling. */
export function mercedesClassLetter(modelSlug: string | null | undefined): string | null {
  if (!modelSlug) return null;
  const m = /^([a-z])-class(?:-|$)/.exec(modelSlug);
  const letter = m?.[1];
  return letter && MERCEDES_CLASS_LETTERS.has(letter) ? letter : null;
}

/**
 * Rewrites an already-slugified BMW model string into our canonical
 * `${n}-series[-<detail>]` form (n = 1..8), tolerating every spelling
 * sources use for a numbered BMW series:
 *   - Czech: "rada-3" (Řada 3) — confirmed live: sauto.cz's `model_cb.seo_name`
 *     and tipcars.com's listing-detail URL slug for every BMW 3-series car
 *     are literally "rada-3", not "3-series".
 *   - Slovak: "rad-3" (Rad 3, no trailing vowel) — confirmed live:
 *     autobazar.eu's own `carModelValue` for a BMW 3-series car is literally
 *     "Rad 3".
 *   - German: "3er"
 *   - reversed order: "series-3"
 *   - English: "3-series" (already canonical; idempotent)
 *   - a bare engine-designation code with no series word at all, e.g. "320",
 *     "320d", "318i", "530d", "116d" — confirmed live: autoscout24.cz's
 *     structured `vehicle.model` field for a 3-series car is literally "320"
 *     or "318" (no suffix letter, no series word), and aaaauto.cz's ld+json
 *     `model` field for one is the bare digit "3". The series number is the
 *     code's *first* digit (BMW's own numbering scheme: 3xx -> 3 Series, 1xx
 *     -> 1 Series, etc. up to 7xx -> 7 Series); trailing engine-suffix
 *     letters (d/i/e/xd/...) are preserved as part of the detail suffix so
 *     `matcher.ts`'s `${query}-` prefix matching still works.
 *   - an "M Performance" trim of a numbered series, e.g. "m340i", "m235i",
 *     "m550i" — these are trims of the base series (BMW sells them alongside
 *     the ordinary 340i/235i/550i, same chassis), so they're folded into
 *     that series too, as `${n}-series-m<code>`.
 * Deliberately NOT touched: bare `M2`/`M3`/`M4`/`M5`/`M6`/`M8` (the standalone
 * M-badged model line — a distinct chassis/engine, not just a series trim,
 * so a "3-series" search should not silently pull in M3s), and the X/Z/i
 * lines (`x1`, `x5`, `z4`, `i3`, `i4`, `ix`, ...), which are separate model
 * lines already spelled consistently across sources and need no aliasing.
 */
function applyBmwModelAlias(slug: string): string {
  const tokens = slug.split("-").filter(Boolean);
  if (tokens.length === 0) return slug;
  const [first, ...rest] = tokens;
  if (!first) return slug;

  // Already canonical "N-series[-detail]".
  if (/^[1-8]$/.test(first) && rest[0] === "series") return slug;

  // Czech "Řada N" -> "rada-n".
  if (first === "rada" && rest[0] && /^[1-8]$/.test(rest[0])) {
    return [`${rest[0]}-series`, ...rest.slice(1)].join("-");
  }
  // Slovak "Rad N" -> "rad-n" (confirmed live: autobazar.eu's own
  // `carModelValue` for a BMW 3-series car is literally "Rad 3", not the
  // Czech "Řada 3" — distinct enough from "rada" above, with no trailing
  // vowel, that it needs its own branch rather than falling through).
  if (first === "rad" && rest[0] && /^[1-8]$/.test(rest[0])) {
    return [`${rest[0]}-series`, ...rest.slice(1)].join("-");
  }
  // Reversed "series-n".
  if (first === "series" && rest[0] && /^[1-8]$/.test(rest[0])) {
    return [`${rest[0]}-series`, ...rest.slice(1)].join("-");
  }
  // German "3er".
  let m = /^([1-8])er$/.exec(first);
  if (m) return [`${m[1]}-series`, ...rest].join("-");

  // A bare series number with no other token, e.g. "3".
  if (tokens.length === 1 && /^[1-8]$/.test(first)) return `${first}-series`;

  // "M Performance" trim of a numbered series, e.g. "m340i", "m235i".
  m = /^m([1-8])(\d{2}[a-z]*)$/.exec(first);
  if (m) return [`${m[1]}-series`, `m${m[1]}${m[2]}`, ...rest].join("-");

  // Bare engine-designation code, e.g. "320", "320d", "318i", "116d".
  m = /^([1-8])(\d{2})([a-z]*)$/.exec(first);
  if (m) return [`${m[1]}-series`, first, ...rest].join("-");

  return slug;
}

/** If `modelSlug` (as produced by `normalizeModel`) is one of the canonical
 * numbered BMW series (1-series, 2-series, ..., 8-series), returns the bare
 * digit; otherwise null. Exported so source adapters that need the source's
 * own spelling of a whole series (sauto/tipcars: "rada-<n>"; aaaauto: bare
 * "<n>") can translate our canonical slug back to it, the same way
 * `mercedesClassLetter` does for Mercedes-Benz classes. */
export function bmwSeriesNumber(modelSlug: string | null | undefined): string | null {
  if (!modelSlug) return null;
  const m = /^([1-8])-series(?:-|$)/.exec(modelSlug);
  return m?.[1] ?? null;
}

/** If `modelSlug` (as produced by `normalizeModel` for make "volkswagen") is
 * one of the canonical bare-digit VW "ID." models (id-3, id-4, id-5, ...),
 * returns aaaauto.cz's own hyphen-less URL model-path spelling for it
 * ("id3", "id4", ...); otherwise null. Confirmed live: aaaauto.cz's
 * `/ojete-vozy/volkswagen/id-4` 302-redirects to its unfiltered listing
 * (soft-404), while `/ojete-vozy/volkswagen/id4` filters correctly. Exported
 * so aaaauto's adapter can translate our canonical slug back to it, the same
 * way `mercedesClassLetter`/`bmwSeriesNumber` do for their sources. */
export function vwIdModelUrlSlug(modelSlug: string | null | undefined): string | null {
  if (!modelSlug) return null;
  const m = /^id-([3-7])(?:-|$)/.exec(modelSlug);
  return m?.[1] ? `id${m[1]}` : null;
}

/** True if `modelSlug` (as produced by `normalizeModel` for make
 * "volkswagen") is one of the T4-T7 "Transporter family" van names
 * (multivan, transporter, caravelle, california) with no generation detail,
 * i.e. exactly what a loose saved search carries. Exported for adapters that,
 * like carvago (confirmed live), have no generation-less model slug for
 * these — carvago's own catalog only has per-generation slugs
 * ("t6-multivan", "t6-transporter", ...; confirmed live those work), and
 * `/cs/auta/volkswagen/multivan` (no generation) 308-redirects to the
 * unfiltered `/cs/auta/volkswagen` listing instead of 404ing or filtering.
 * Since a saved search only ever carries the generation-less name, such
 * adapters should omit the model path segment for these (make filter +
 * client-side `matchesSearch` narrows the rest), same as they already do for
 * the analogous Mercedes-Benz lettered-class / BMW numbered-series case. */
export function isVwVanFamilyModel(modelSlug: string | null | undefined): boolean {
  if (!modelSlug) return false;
  return VW_VAN_MODEL_WORDS.has(modelSlug);
}

/** Toyota spells its compact SUV "RAV4" (no space/hyphen before the digit);
 * naive slugifying of a source's "RAV 4" text produces "rav-4", which would
 * never match the catalog's "rav4" slug without this. */
function applyToyotaModelAlias(slug: string): string {
  if (slug === "rav-4" || slug.startsWith("rav-4-")) return slug.replace(/^rav-4/, "rav4");
  return slug;
}

/** Mazda's own listing data typically gives the bare model number ("2", "3",
 * "6") since the make is already "Mazda" — our catalog (and most sources'
 * own URLs) instead use "mazda2"/"mazda3"/"mazda6". */
function applyMazdaModelAlias(slug: string): string {
  const tokens = slug.split("-").filter(Boolean);
  const first = tokens[0];
  if (first && /^[236]$/.test(first)) {
    return [`mazda${first}`, ...tokens.slice(1)].join("-");
  }
  return slug;
}

/** Kia's "Ceed" is stylized "cee'd" (or, live on sauto.cz, with a bare acute
 * accent character "cee´d" instead of a plain apostrophe) by several
 * sources — confirmed live: sauto.cz's title text for every Ceed listing is
 * "Kia Cee´d", which `slugifyMakeModel` (any non-alnum run -> a single
 * hyphen) turns into "cee-d", not our catalog's plain "ceed". aaaauto.cz and
 * tipcars.com, by contrast, already spell it "Ceed" with no punctuation —
 * this rewrite is a no-op for them. */
function applyKiaModelAlias(slug: string): string {
  if (slug === "cee-d" || slug.startsWith("cee-d-")) return slug.replace(/^cee-d/, "ceed");
  return slug;
}

/** VW electric "ID." range (id-3/id-4/id-5/id-buzz, ...) and the T4-T7
 * "Transporter family" vans (Multivan/Transporter/Caravelle/California),
 * tolerating spellings confirmed live across sources:
 *   - bare, no separator: "id3"/"id4"/"id5" (aaaauto.cz's own URL model-path
 *     segment for these, confirmed live — the hyphenated "id-4" 302-redirects
 *     to its unfiltered listing there) and "idbuzz" -> our canonical
 *     "id-3"/"id-4"/"id-5"/"id-buzz".
 *   - generation-code-first: "t6-multivan", "t6-1-multivan" (autoscout24.cz's
 *     structured `vehicle.model` field for a VW Multivan, confirmed live to
 *     be literally "T6 Multivan"/"T6.1 Multivan", not just "Multivan") ->
 *     rewritten to `multivan[-<generation>]` so it matches (and is a
 *     more-specific prefix of) our canonical "multivan". Same for
 *     transporter/caravelle/california.
 */
const VW_VAN_MODEL_WORDS = new Set(["multivan", "transporter", "caravelle", "california"]);
const VW_VAN_GENERATION_PREFIX = /^t([4-9])(-\d+)?-/;

function applyVolkswagenModelAlias(slug: string): string {
  // Bare "id3"/"id4"/.../"id7" (no separator) -> "id-3".../"id-7".
  let m = /^id([3-7])(?:-|$)/.exec(slug);
  if (m) return slug.replace(/^id[3-7]/, `id-${m[1]}`);
  // "idbuzz" -> "id-buzz".
  if (slug === "idbuzz" || slug.startsWith("idbuzz-")) return slug.replace(/^idbuzz/, "id-buzz");

  // Generation-code-first van naming, e.g. "t6-multivan", "t6-1-transporter".
  m = VW_VAN_GENERATION_PREFIX.exec(slug);
  if (m) {
    const generation = m[0].slice(0, -1); // drop the trailing separator hyphen
    const rest = slug.slice(m[0].length).split("-");
    if (rest[0] && VW_VAN_MODEL_WORDS.has(rest[0])) {
      return [rest[0], generation, ...rest.slice(1)].join("-");
    }
  }
  return slug;
}

/** Land Rover's "Range Rover" sub-line has several distinct model names that
 * sources sometimes spell with the "Range Rover" prefix and sometimes
 * without, confirmed live (sauto.cz `model_cb.seo_name`, tipcars.com URL
 * slugs, aaaauto.cz ld+json `model`, autoscout24.cz structured `vehicle.model`
 * and carvago.com's `model.label` all agree on the exact same spellings):
 *   - Evoque: every one of those 5 sources' own slug/name is
 *     "range-rover-evoque" ("Range Rover Evoque"), never bare "evoque" — so
 *     our canonical catalog slug matches theirs directly and needs no
 *     adapter-side translation, but a bare "Evoque" (e.g. from a casual
 *     listing title bazos/havex would free-text-infer) is still folded into
 *     the same canonical slug here for robustness.
 *   - Velar: same story, "range-rover-velar" ("Range Rover Velar").
 *   - Range Rover Sport / Discovery Sport: already spelled consistently as
 *     "range-rover-sport"/"discovery-sport" everywhere confirmed live — no
 *     rewrite needed, kept as-is.
 *   - Bare "Range Rover" (no Sport/Evoque/Velar suffix): confirmed live as
 *     sauto.cz's own `model_cb.seo_name` for the base model, matches our
 *     canonical "range-rover" as-is.
 */
function applyLandRoverModelAlias(slug: string): string {
  const tokens = slug.split("-").filter(Boolean);
  if (tokens[0] === "evoque" || tokens[0] === "velar") {
    return ["range-rover", ...tokens].join("-");
  }
  return slug;
}

/** Tesla's model line is sometimes reported as a bare letter/digit ("3", "S",
 * "X", "Y", with no "Model" word at all) rather than our canonical
 * "model-<n>" — not confirmed live on sauto/tipcars/aaaauto/autoscout24/
 * carvago (all 5 already use the full "Model 3"/"Model S"/... spelling), but
 * kept for robustness against a source that does, the same defensive pattern
 * as `applyMazdaModelAlias`'s bare-number handling. */
const TESLA_MODEL_LETTERS = new Set(["3", "s", "x", "y"]);

function applyTeslaModelAlias(slug: string): string {
  const tokens = slug.split("-").filter(Boolean);
  const [first, ...rest] = tokens;
  if (!first) return slug;
  if (tokens.length === 1 && TESLA_MODEL_LETTERS.has(first)) return `model-${first}`;
  // A hyphen-less "model3"/"models"/"modelx"/"modely".
  const m = /^model([3sxy])$/.exec(first);
  if (m) return [`model-${m[1]}`, ...rest].join("-");
  return slug;
}

/** Volvo's model names are a letter prefix + a 2-3 digit number (XC60, V60,
 * S90, C40, ...); a source or free-text title that spells it with a space
 * ("XC 60") slugifies to "xc-60", which wouldn't match our catalog's
 * hyphen-less "xc60" without this — not confirmed live as an actual gap on
 * the 5 structured sources (all already report e.g. "XC60" with no space),
 * but kept for robustness (free-text titles on bazos/havex, and any future
 * source) the same way `applyMazdaModelAlias` guards against a spaced-out
 * bare number. */
function applyVolvoModelAlias(slug: string): string {
  const tokens = slug.split("-").filter(Boolean);
  const [first, second, ...rest] = tokens;
  if (first && second && /^(xc|v|s|c)$/.test(first) && /^\d{2,3}$/.test(second)) {
    return [`${first}${second}`, ...rest].join("-");
  }
  return slug;
}

/** Honda's "CR-V"/"HR-V" are hyphenated in our catalog and confirmed live to
 * be spelled that way by every structured source checked (sauto, aaaauto);
 * a hyphen-less "CRV"/"HRV" (free-text title, or a source that drops the
 * hyphen) is folded into the canonical hyphenated slug. */
function applyHondaModelAlias(slug: string): string {
  if (slug === "crv" || slug.startsWith("crv-")) return slug.replace(/^crv/, "cr-v");
  if (slug === "hrv" || slug.startsWith("hrv-")) return slug.replace(/^hrv/, "hr-v");
  return slug;
}

/** Mitsubishi's pickup is catalogued as bare "l200" (confirmed live: sauto's
 * seo_name and aaaauto's ld+json `model` are both "L200", no hyphen) — a
 * "L 200"/"L-200" spelling folds into that same slug. */
function applyMitsubishiModelAlias(slug: string): string {
  if (slug === "l-200" || slug.startsWith("l-200-")) return slug.replace(/^l-200/, "l200");
  return slug;
}

/** Suzuki's SX4 is catalogued as bare "sx4" (confirmed live: sauto's
 * seo_name and aaaauto's own `model` field are both "SX4", no hyphen,
 * distinct from the newer "SX4 S-Cross"/"sx4-s-cross") — a "SX 4"/"SX-4"
 * spelling folds into that same slug. */
function applySuzukiModelAlias(slug: string): string {
  if (slug === "sx-4" || slug.startsWith("sx-4-")) return slug.replace(/^sx-4/, "sx4");
  return slug;
}

/** Audi's "e-tron" SUV was renamed "Q8 e-tron" in its 2023 facelift. Our
 * canonical catalog keeps them as two distinct models — confirmed live that
 * sauto.cz, tipcars.com and autoscout24.cz all genuinely catalog "Q8 e-tron"
 * (`model_cb.seo_name` "q8-e-tron", distinct total count from bare "e-tron")
 * as its own model — but aaaauto.cz and carvago.com have NOT split their own
 * catalog: confirmed live that `/ojete-vozy/audi/q8-e-tron` 302-redirects to
 * aaaauto's unfiltered root listing and `/cs/auta/audi/q8-e-tron`
 * 308-redirects to carvago's unfiltered `/cs/auta` root, while both sources'
 * own structured `model`/`model.label` field for EVERY e-tron/Q8 e-tron car
 * is literally just "e-tron". Exported so those two adapters can translate
 * our canonical "q8-e-tron" back to their own "e-tron" slug instead of
 * silently falling through to the unfiltered catalog (same pattern as
 * `mercedesClassLetter`/`bmwSeriesNumber`/`vwIdModelUrlSlug`). */
export function audiQ8EtronFallbackSlug(modelSlug: string | null | undefined): string | null {
  if (!modelSlug) return null;
  return modelSlug === "q8-e-tron" || modelSlug.startsWith("q8-e-tron-") ? "e-tron" : null;
}

/** Per-make model-alias functions, applied after basic slugifying so every
 * real-world spelling sources use converges on one canonical slug per make's
 * model (see each function's doc comment for the spellings it covers). Keyed
 * by the *canonical* make slug (`normalizeMake`'s output). Extend this table
 * — rather than special-casing `normalizeModel` further — when a new make's
 * models turn out to need aliasing too. */
const MODEL_ALIAS_FNS: Record<string, (slug: string) => string> = {
  "mercedes-benz": applyMercedesModelAlias,
  bmw: applyBmwModelAlias,
  toyota: applyToyotaModelAlias,
  mazda: applyMazdaModelAlias,
  kia: applyKiaModelAlias,
  volkswagen: applyVolkswagenModelAlias,
  "land-rover": applyLandRoverModelAlias,
  tesla: applyTeslaModelAlias,
  volvo: applyVolvoModelAlias,
  honda: applyHondaModelAlias,
  mitsubishi: applyMitsubishiModelAlias,
  suzuki: applySuzukiModelAlias,
};

/**
 * Normalizes a model name to a comparable slug (best-effort, no full alias
 * table for most makes). When `make` is given (raw or already-normalized)
 * and resolves to a make with a registered alias function (`MODEL_ALIAS_FNS`
 * above — currently Mercedes-Benz, BMW, Toyota, Mazda), also canonicalizes
 * the many spellings sources use for that make's models (e.g. Mercedes
 * "Třída V"/"Třídy V"/"V-Klasse"/"V-Class"/"V", or BMW "Řada 3"/"3er"/"320d")
 * so listings and saved-search queries spelled differently still normalize
 * to the same slug — without this, they'd never match each other (see
 * catalog.ts, matcher.ts).
 */
export function normalizeModel(value: string | null | undefined, make?: string | null): string | null {
  if (!value) return null;
  const slug = slugifyMakeModel(value);
  if (!slug) return null;
  const canonicalMake = make ? normalizeMake(make) : null;
  const aliasFn = canonicalMake ? MODEL_ALIAS_FNS[canonicalMake] : null;
  return aliasFn ? aliasFn(slug) : slug;
}
