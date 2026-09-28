/**
 * Shared whole-token text matching, used by both the equipment/version
 * feature detection (`features.ts`) and the general keyword search box
 * (`matcher.ts`). Matching is always on whole tokens, never a substring of a
 * longer one: "L2" never matches "L20" or "HL2", "long" never matches
 * "Longitude" (a real trim name), and "havarovaná" never matches
 * "nehavarovaná" — a prefix/suffix sharing letters is not the same word.
 */
import { normalizeEnumToken } from "./enums.js";

/** Splits text into lowercase, diacritics-stripped alphanumeric tokens.
 * "L2H1" stays one token (no internal separator); "4×4"/"4x4" both become
 * the single token "4x4"; any other punctuation/whitespace is a boundary. */
export function tokenize(text: string): string[] {
  return normalizeEnumToken(text)
    .replace(/×/g, "x")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True if `needle` (one or more words) appears as a contiguous, exact
 * sequence of whole tokens somewhere in `haystack`.
 */
export function includesPhrase(haystack: string, needle: string): boolean {
  const haystackTokens = tokenize(haystack);
  const needleTokens = tokenize(needle);
  if (needleTokens.length === 0) return false;

  for (let i = 0; i + needleTokens.length <= haystackTokens.length; i++) {
    let matched = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (haystackTokens[i + j] !== needleTokens[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
