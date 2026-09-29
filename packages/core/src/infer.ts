/**
 * Best-effort make/model extraction from a free-text listing title, used as a
 * fallback by `normalizeListing` (and some source adapters directly) when a
 * source doesn't expose make/model as separate structured fields — e.g.
 * Bazoš, Auto ESA, Das WeltAuto (model only) and Havex (make+model combined
 * in one heading).
 */
import { DRIVE_ALIASES, normalizeEnumToken, type DriveType } from "./enums.js";
import { MAKE_ALIASES, normalizeModel } from "./make-model.js";
import { POPULAR_MODELS, type ModelOption } from "./catalog.js";

export interface InferredMakeModel {
  make: string | null;
  model: string | null;
}

/** Alias phrases sorted so multi-word / longer aliases are tried before
 * shorter ones (e.g. "land rover" before "land", "mercedes-benz" before "mb"). */
const MAKE_ALIAS_ENTRIES = Object.keys(MAKE_ALIASES)
  .map((key) => ({ phrase: normalizeEnumToken(key), canonical: MAKE_ALIASES[key]! }))
  .sort(
    (a, b) =>
      b.phrase.split(/[\s-]+/).length - a.phrase.split(/[\s-]+/).length || b.phrase.length - a.phrase.length
  );

function normalizeTitleText(title: string): string {
  return normalizeEnumToken(title)
    .replace(/×/g, "x") // "4×4" -> "4x4"
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Finds the longest catalog model (e.g. "octavia-combi" before "octavia")
 * that appears as a whole-word phrase anywhere in `normalizedText`. */
function findModelInText(normalizedText: string, models: ModelOption[]): string | null {
  const padded = ` ${normalizedText} `;
  const sorted = [...models].sort(
    (a, b) => b.slug.split("-").length - a.slug.split("-").length || b.slug.length - a.slug.length
  );
  for (const m of sorted) {
    const phrase = ` ${m.slug.replace(/-/g, " ")} `;
    if (padded.includes(phrase)) return m.slug;
  }
  return null;
}

/** Common engine/trim codes that show up right after a model name in a
 * title ("2.0 TDI", "E220 CDI") — excluded from the fallback below so they
 * don't get glued onto the inferred model slug. */
const ENGINE_CODE_RE =
  /^(tdi|tsi|tfsi|fsi|hdi|cdi|dci|crdi|cdti|dti|d4d|bluetec|bluehdi|multijet|dtec|vti|mpi|gdi|thp|ecoblue|ecoboost|dsg|cvt)$/;

/** Uncatalogued-model fallback: takes up to 2 leading alphanumeric words (no
 * pure-digit or known engine-code words) from the text following the make,
 * e.g. "tourneo custom 2.0 tdci" -> "tourneo-custom". Best-effort only. */
function fallbackModelWords(words: string[]): string | null {
  const picked: string[] = [];
  for (const w of words) {
    if (picked.length >= 2) break;
    if (!/^[a-z][a-z0-9]*$/.test(w) || ENGINE_CODE_RE.test(w)) break;
    picked.push(w);
  }
  return picked.length ? picked.join("-") : null;
}

/**
 * Infers make/model from a free-text title.
 *
 * - With no `knownMake`, scans for the longest recognized make alias phrase
 *   anywhere in the title, then derives the model from the text following it
 *   (preferring a catalog match, falling back to the next 1-2 plain words).
 * - With `knownMake` given (make already known from structured data, only
 *   the model is missing), skips make detection and searches the whole title
 *   for one of that make's catalog models.
 */
export function inferMakeModel(
  title: string | null | undefined,
  knownMake?: string | null
): InferredMakeModel {
  if (!title) return { make: knownMake ?? null, model: null };
  const normalized = normalizeTitleText(title);
  if (!normalized) return { make: knownMake ?? null, model: null };

  if (knownMake) {
    const models = POPULAR_MODELS[knownMake] ?? [];
    const model = findModelInText(normalized, models) ?? fallbackModelWords(normalized.split(" "));
    return { make: knownMake, model: model ? (normalizeModel(model, knownMake) ?? model) : null };
  }

  for (const { phrase, canonical } of MAKE_ALIAS_ENTRIES) {
    const padded = ` ${normalized} `;
    const needle = ` ${phrase} `;
    const idx = padded.indexOf(needle);
    if (idx === -1) continue;

    const rest = padded.slice(idx + needle.length).trim();
    const restWords = rest.split(" ").filter(Boolean);
    const models = POPULAR_MODELS[canonical] ?? [];
    const model = rest ? (findModelInText(rest, models) ?? fallbackModelWords(restWords)) : null;
    return { make: canonical, model: model ? (normalizeModel(model, canonical) ?? model) : null };
  }

  return { make: null, model: null };
}

/** Drive-type alias phrases, longest first (so e.g. "sh-awd" is tried before
 * a shorter overlapping key would ever matter). */
const DRIVE_ALIAS_ENTRIES = Object.entries(DRIVE_ALIASES)
  .map(([key, canonical]) => ({ phrase: normalizeEnumToken(key), canonical }))
  .sort((a, b) => b.phrase.length - a.phrase.length);

/**
 * Best-effort drive-type (AWD/FWD/RWD) inference from free-text title +
 * variant, e.g. "Ford Tourneo Custom 2.0 EcoBlue 4x4 L2" -> "awd". Returns
 * null when no recognized synonym is present (most listings don't mention
 * drivetrain at all, which is expected and left as "unknown").
 */
export function inferDrive(text: string | null | undefined): DriveType | null {
  if (!text) return null;
  const normalized = normalizeTitleText(text);
  if (!normalized) return null;
  const padded = ` ${normalized} `;
  for (const { phrase, canonical } of DRIVE_ALIAS_ENTRIES) {
    if (padded.includes(` ${phrase} `)) return canonical;
  }
  return null;
}
