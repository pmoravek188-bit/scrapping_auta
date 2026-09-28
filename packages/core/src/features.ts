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
    ],
  },
];

/** Every taggable group (equipment + version), keyed by id — used to resolve
 * a `SearchQuery.features` id to its synonym list regardless of which UI
 * section it's shown under. */
export const ALL_FEATURE_GROUPS: FeatureGroup[] = [...FEATURE_GROUPS, ...VERSION_GROUPS];
const FEATURE_GROUP_BY_ID = new Map(ALL_FEATURE_GROUPS.map((g) => [g.id, g]));

/** True if `haystack` contains any of `group`'s synonyms, matched as whole
 * tokens (see module doc — never a substring of a longer token). */
function groupMatches(haystack: string, group: FeatureGroup): boolean {
  return group.synonyms.some((syn) => includesPhrase(haystack, syn));
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

/** True if `text` contains every one of the requested feature ids. */
export function hasAllFeatures(text: string | null | undefined, featureIds: string[]): boolean {
  if (featureIds.length === 0) return true;
  if (!text) return false;
  return featureIds.every((id) => {
    const group = FEATURE_GROUP_BY_ID.get(id);
    return group ? groupMatches(text, group) : false;
  });
}
