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

/** Normalizes a model name to a comparable slug (best-effort, no full alias table). */
export function normalizeModel(value: string | null | undefined): string | null {
  if (!value) return null;
  return slugifyMakeModel(value) || null;
}
