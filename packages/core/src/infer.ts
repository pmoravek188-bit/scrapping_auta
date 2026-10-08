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
 * that appears as a whole-word phrase anywhere in `normalizedText`. Tries
 * both the model's canonical slug (e.g. "3-series" -> "3 series") AND its
 * catalog label (e.g. "Řada 3" -> "rada 3") as candidate phrases — sources
 * that don't expose a structured model field often spell it in their own
 * language/notation in the title (Czech "Řada 3", German "3er", ...) rather
 * than the slug's English wording, so slug-only matching would silently miss
 * those and fall through to `fallbackModelWords`, which stops at the first
 * digit and would truncate "Řada 3" down to just "Řada" (losing the series
 * number entirely — confirmed live via the audit script against Auto ESA
 * titles like "BMW Řada 3 2011"). Matching the label too fixes this
 * generically for every make's catalog, not just BMW. */
function findModelInText(normalizedText: string, models: ModelOption[]): string | null {
  const padded = ` ${normalizedText} `;
  const candidates = models.flatMap((m) => {
    const slugPhrase = m.slug.replace(/-/g, " ");
    const labelPhrase = normalizeTitleText(m.label).replace(/-/g, " ");
    const phrases = new Set([slugPhrase, labelPhrase]);
    return [...phrases].map((phrase) => ({ slug: m.slug, phrase }));
  });
  const sorted = candidates.sort(
    (a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length || b.phrase.length - a.phrase.length
  );
  for (const c of sorted) {
    if (padded.includes(` ${c.phrase} `)) return c.slug;
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
 * e.g. "tourneo custom 2.0 tdci" -> "tourneo-custom". Best-effort only.
 *
 * Deliberately rejects any word starting with a digit (so e.g. Peugeot's
 * "308 1.6 HDI" doesn't swallow an engine-displacement number as a model) —
 * BMW's numbered-series titles need their own fallback (`bmwFallbackModel`
 * below) specifically because a bare series digit IS meaningful there. */
function fallbackModelWords(words: string[]): string | null {
  const picked: string[] = [];
  for (const w of words) {
    if (picked.length >= 2) break;
    if (!/^[a-z][a-z0-9]*$/.test(w) || ENGINE_CODE_RE.test(w)) break;
    picked.push(w);
  }
  return picked.length ? picked.join("-") : null;
}

/** A bare BMW series digit (1-8), e.g. "3" in "BMW 3 325i Touring". */
const BMW_SERIES_DIGIT_RE = /^[1-8]$/;
/** A bare BMW engine-designation code with no series word at all, e.g.
 * "320d", "325i", "530d" — same shape `applyBmwModelAlias` (make-model.ts)
 * recognizes for a structured model field, first digit = the series. */
const BMW_ENGINE_CODE_RE = /^([1-8])(\d{2})([a-z]*)$/;
/** An "M Performance" trim with no series word, e.g. "M340i", "M550i". */
const BMW_M_PERFORMANCE_RE = /^m([1-8])(\d{2}[a-z]*)$/;

/** BMW-specific uncatalogued-model fallback for titles that spell a numbered
 * series the "bare European way" — a plain digit right after the make, with
 * no "Řada"/"Series"/"er" word at all (e.g. "BMW 3 325i TOURING", "BMW 5
 * 520d xDrive", "BMW 6 4,4 V8") — which `findModelInText` can't catch (every
 * BMW catalog entry requires the word "Řada"/"series" to be literally
 * present in the title) and the generic `fallbackModelWords` above can't
 * catch either (it deliberately refuses any word starting with a digit).
 * Also handles an engine-code-only title with no separate series digit at
 * all (e.g. "BMW 320d Touring"). Tried only when `knownMake`/the detected
 * make is "bmw", so other makes where a bare digit IS the real model
 * (Mazda 2/3/6, Peugeot 208/308/2008/3008/508, Fiat 500, ...) are unaffected
 * — those already match directly via `findModelInText` against the catalog
 * (the digit itself is the catalog slug/label, no translation needed).
 * Returns an already-canonical "`n`-series[-detail]" slug (or null), which
 * `normalizeModel`/`applyBmwModelAlias` (make-model.ts) then passes through
 * unchanged (idempotent). */
function bmwFallbackModel(words: string[]): string | null {
  const [first, second] = words;
  if (!first) return null;

  // Engine-code-only title, e.g. "320d" ("BMW 320d Touring").
  let m = BMW_ENGINE_CODE_RE.exec(first);
  if (m) return `${m[1]}-series-${first}`;

  // "M Performance" trim with no series word, e.g. "M340i" ("BMW M340i xDrive").
  m = BMW_M_PERFORMANCE_RE.exec(first);
  if (m) return `${m[1]}-series-m${m[1]}${m[2]}`;

  // Bare series digit, e.g. "3" ("BMW 3 325i TOURING", "BMW 6 4,4 V8",
  // "BMW 5 520d xDrive"). If the next word is itself a matching engine code
  // for the same series, fold it in as detail; otherwise just the series.
  if (BMW_SERIES_DIGIT_RE.test(first)) {
    if (second) {
      const engineMatch = BMW_ENGINE_CODE_RE.exec(second);
      if (engineMatch && engineMatch[1] === first) return `${first}-series-${second}`;
    }
    return `${first}-series`;
  }

  return null;
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
    const words = normalized.split(" ");
    const model =
      findModelInText(normalized, models) ??
      (knownMake === "bmw" ? bmwFallbackModel(words) : null) ??
      fallbackModelWords(words);
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
    const model = rest
      ? (findModelInText(rest, models) ??
        (canonical === "bmw" ? bmwFallbackModel(restWords) : null) ??
        fallbackModelWords(restWords))
      : null;
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
