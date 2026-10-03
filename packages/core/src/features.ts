/**
 * Equipment ("Výbava") detection: a curated list of feature groups a user
 * can tick in the search form, each with a Czech label and a list of
 * synonyms (Czech/German/English wording, abbreviations) that identify it in
 * free-text listing content (title, variant, and — where a source exposes
 * it cheaply — an equipment/description blob).
 *
 * All matching here is WHOLE-TOKEN, never substring: a synonym like "L2" or
 * "long" must appear as its own token (after normalizing case/diacritics and
 * splitting on non-alphanumeric characters) — "L2" never matches "L20" or
 * "HL2", and "long" never matches "Longitude" (a real Jeep Compass trim
 * name). This applies to every feature group, including the "Verze"
 * (wheelbase/length) group below, and to the general keyword/exclude-keyword
 * search box in `matcher.ts` (see `includesToken` there, backed by the same
 * `includesPhrase` helper).
 */
import { includesPhrase } from "./text-match.js";

export interface FeatureGroup {
  id: string;
  label: string;
  synonyms: string[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "tazne",
    label: "Tažné zařízení",
    synonyms: ["tažné", "tažné zařízení", "tazne", "anhängerkupplung", "ahk", "towbar"],
  },
  {
    id: "7mist",
    label: "7 míst",
    synonyms: ["7 míst", "7míst", "7 sedadel", "7-sitzer", "7 seats"],
  },
  {
    id: "kamera",
    label: "Couvací kamera",
    synonyms: ["kamera", "couvací kamera", "rückfahrkamera", "camera"],
  },
  {
    id: "navigace",
    label: "Navigace",
    synonyms: ["navi", "navigace", "navigation"],
  },
  {
    id: "kuze",
    label: "Kožené sedačky",
    synonyms: ["kůže", "kožené", "leder", "leather"],
  },
  {
    id: "panorama",
    label: "Panoramatická střecha",
    synonyms: ["panorama"],
  },
  {
    id: "acc",
    label: "Adaptivní tempomat",
    synonyms: ["acc", "adaptivní tempomat", "distronic"],
  },
  {
    id: "vyhrev",
    label: "Vyhřívaná sedadla",
    synonyms: ["vyhřívaná sedadla", "sitzheizung", "heated seats"],
  },
  {
    id: "led",
    label: "LED světla",
    synonyms: ["led", "matrix"],
  },
  {
    id: "webasto",
    label: "Nezávislé topení",
    synonyms: ["webasto", "nezávislé topení", "standheizung"],
  },
  {
    id: "dph",
    label: "Odpočet DPH",
    synonyms: ["odpočet dph", "dph"],
  },
  {
    id: "servisni_kniha",
    label: "Servisní knížka",
    synonyms: ["servisní knížka", "servisní kniha"],
  },
  {
    id: "1majitel",
    label: "1. majitel",
    synonyms: ["1. majitel", "1 majitel", "první majitel", "1.maj", "1maj"],
  },
  {
    id: "msport",
    label: "BMW M Sport",
    synonyms: ["m sport", "msport", "m sportpaket", "m paket", "m package", "m packet", "m sport pro"],
  },
];

/**
 * "Verze" (wheelbase/body length) — shown as its own chip row next to
 * "Pohon", not folded into the "Výbava" equipment list, since it's about the
 * car's variant/size rather than optional equipment. Kept as a separate
 * exported group for the UI, but matched through the same id-based
 * mechanism as FEATURE_GROUPS (see `ALL_FEATURE_GROUPS`/`hasAllFeatures`).
 */
export const VERSION_GROUPS: FeatureGroup[] = [
  {
    id: "prodlouzena",
    label: "Prodloužená verze (L2/Long)",
    synonyms: [
      "L2",
      "L3",
      "L2H1",
      "L2H2",
      "L3H2",
      "LWB",
      "long",
      "lang",
      "lange version",
      "langer radstand",
      "dlouhá",
      "dlouhý",
      "prodloužená",
      "prodloužený",
      "extended",
      "XL",
      "maxi",
      "Langversion",
      // Added for detail-page description/equipment text (see
      // scrapers/runner.ts's near-match enrichment pass): common Czech/German
      // wordings for a long wheelbase found live in listing descriptions,
      // beyond the model-name-style synonyms above. Multi-word synonyms match
      // as a contiguous token sequence (see includesPhrase) — never a
      // standalone "rozvor"/"radstand" alone, since a wheelbase is mentioned
      // on plenty of listings that are NOT the long version.
      "dlouhý rozvor",
      "dlouhým rozvorem",
      "prodloužený rozvor",
      "prodlouženým rozvorem",
      "radstand lang",
      "long wheelbase",
    ],
  },
];

/** A length mentioned in listing text at or above this (in mm) is treated as
 * the long-wheelbase/extended-body version for the "prodlouzena" group —
 * e.g. a VW T6/T7 Multivan/Transporter's long body is ~5300mm vs ~4900-5150mm
 * standard/short. Deliberately conservative (only used as a fallback when no
 * textual synonym matched) and bounded above by a sane passenger-vehicle
 * length so a stray unrelated number (e.g. a cargo volume in liters) can't be
 * misread as a length. */
const PRODLOUZENA_LENGTH_THRESHOLD_MM = 5200;
const MAX_SANE_VEHICLE_LENGTH_MM = 7000;

const LENGTH_MM_RE = /(\d{4,5})\s*mm\b/gi;
/** "5,30 m" / "5.30 m" (never "mm", handled above) — a bare decimal meters
 * figure, as sometimes given for overall vehicle length. */
const LENGTH_M_RE = /(\d[.,]\d{1,2})\s*m\b(?!m)/gi;

/** True if free text mentions a vehicle length/wheelbase at or above the
 * long-wheelbase threshold (see `PRODLOUZENA_LENGTH_THRESHOLD_MM`). Used as a
 * structured-data fallback for the "prodlouzena" (Verze/wheelbase) feature
 * group when no textual synonym matched — see `groupMatches` below. */
export function detectLengthBasedProdlouzena(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const m of text.matchAll(LENGTH_MM_RE)) {
    const mm = Number(m[1]);
    if (mm >= PRODLOUZENA_LENGTH_THRESHOLD_MM && mm <= MAX_SANE_VEHICLE_LENGTH_MM) return true;
  }
  for (const m of text.matchAll(LENGTH_M_RE)) {
    const meters = Number((m[1] ?? "").replace(",", "."));
    if (
      meters >= PRODLOUZENA_LENGTH_THRESHOLD_MM / 1000 &&
      meters <= MAX_SANE_VEHICLE_LENGTH_MM / 1000
    ) {
      return true;
    }
  }
  return false;
}

/** Every taggable group (equipment + version), keyed by id — used to resolve
 * a `SearchQuery.features` id to its synonym list regardless of which UI
 * section it's shown under. */
export const ALL_FEATURE_GROUPS: FeatureGroup[] = [...FEATURE_GROUPS, ...VERSION_GROUPS];
const FEATURE_GROUP_BY_ID = new Map(ALL_FEATURE_GROUPS.map((g) => [g.id, g]));

/** True if `haystack` contains any of `group`'s synonyms, matched as whole
 * tokens (see module doc — never a substring of a longer token), OR (for the
 * "prodlouzena" group only) a structured length/wheelbase figure at or above
 * the long-wheelbase threshold (see `detectLengthBasedProdlouzena`). */
function groupMatches(haystack: string, group: FeatureGroup): boolean {
  if (group.synonyms.some((syn) => includesPhrase(haystack, syn))) return true;
  if (group.id === "prodlouzena" && detectLengthBasedProdlouzena(haystack)) return true;
  return false;
}

/**
 * Detects which feature-group ids (equipment + version) are present in
 * free-text listing content (title + variant + any equipment/description
 * text a source exposes).
 */
export function detectFeatures(text: string | null | undefined): string[] {
  if (!text) return [];
  return ALL_FEATURE_GROUPS.filter((g) => groupMatches(text, g)).map((g) => g.id);
}

/**
 * True if `text` (or `confirmedIds`) accounts for every one of the requested
 * feature ids.
 *
 * `confirmedIds` (optional) lets a caller short-circuit the free-text scan
 * for a feature id it already knows is present by other means — currently
 * used for `Listing.detailFeatures`, populated by the scraper runner's
 * detail-page enrichment pass (packages/scrapers/src/runner.ts) for listings
 * whose LIST-page text (`text` here) doesn't mention a feature that's only
 * stated on the detail page. A confirmed id is treated as satisfied
 * regardless of what `text` says (or even when `text` is empty).
 */
export function hasAllFeatures(
  text: string | null | undefined,
  featureIds: string[],
  confirmedIds?: string[] | null
): boolean {
  if (featureIds.length === 0) return true;
  const confirmed = confirmedIds && confirmedIds.length > 0 ? new Set(confirmedIds) : null;
  return featureIds.every((id) => {
    if (confirmed?.has(id)) return true;
    if (!text) return false;
    const group = FEATURE_GROUP_BY_ID.get(id);
    return group ? groupMatches(text, group) : false;
  });
}
