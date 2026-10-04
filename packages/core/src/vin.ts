/**
 * VIN (vehicle identification number) extraction/validation. A VIN is always
 * 17 characters, using only digits and uppercase letters EXCEPT I/O/Q (to
 * avoid confusion with 1/0), per ISO 3779. This is deliberately a plain
 * format check, not a checksum validator (the check-digit algorithm, position
 * 9, is only standardized/meaningful for North American VINs) — good enough
 * to confirm "this looks like a VIN" in free text without false-rejecting
 * every real European VIN.
 */
const VIN_CHAR_CLASS = "[A-HJ-NPR-Z0-9]";
const VIN_RE = new RegExp(`\\b${VIN_CHAR_CLASS}{17}\\b`);

/** True if `vin` is exactly 17 characters from the valid VIN alphabet. */
export function isValidVinFormat(vin: string | null | undefined): boolean {
  if (!vin) return false;
  return new RegExp(`^${VIN_CHAR_CLASS}{17}$`).test(vin.trim().toUpperCase());
}

/**
 * Finds the first 17-character VIN-shaped token in free text (e.g. a listing
 * detail page's description), case-insensitively, as a whole token (word
 * boundary on both sides, so it won't match the middle of a longer
 * alphanumeric run). Returns the match upper-cased, or null if none found.
 */
export function extractVin(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.toUpperCase().match(VIN_RE);
  return match ? match[0] : null;
}
