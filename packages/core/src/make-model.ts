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
