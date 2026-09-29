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
 * Normalizes a model name to a comparable slug (best-effort, no full alias
 * table for most makes). When `make` is given (raw or already-normalized)
 * and resolves to Mercedes-Benz, also canonicalizes the many spellings
 * sources use for its lettered classes (see `applyMercedesModelAlias`) so
 * "Třída V"/"Třídy V"/"V-Klasse"/"V-Class"/"V" all normalize to the same
 * "v-class" slug — without this, listings and saved-search queries spelled
 * differently would never match each other (see catalog.ts, matcher.ts).
 */
export function normalizeModel(value: string | null | undefined, make?: string | null): string | null {
  if (!value) return null;
  const slug = slugifyMakeModel(value);
  if (!slug) return null;
  if (make && normalizeMake(make) === "mercedes-benz") {
    return applyMercedesModelAlias(slug);
  }
  return slug;
}
