/**
 * Shared parsing helpers for the sources owned in this batch (bazos,
 * dasweltauto, havex, autoesa, skodaplus, autoscout24). Kept separate from
 * `generic-html.ts` (owned by the other batch) to avoid merge conflicts.
 */
import { parseFuelType, parseTransmissionType } from "@scrapping-auta/core";
import type { FuelType, TransmissionType } from "@scrapping-auta/core";

/** Matches a 4-digit year in a sane car-registration range (1950-2049). */
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/;
/** "r.v. 2015", "rok výroby 2015", "výroba 2015" style explicit markers, checked first. */
const YEAR_RV_RE = /\br\.?\s*v\.?\s*(\d{4})\b/i;

export function extractYear(text: string): number | null {
  const rv = YEAR_RV_RE.exec(text);
  if (rv) return Number(rv[1]);
  const m = YEAR_RE.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Extracts a mileage in km from free text. Handles "150 000 km", "150000km",
 * "21tkm"/"150 tkm" (tisíc km) and "21 tis. km" style abbreviations.
 */
export function extractMileageKm(text: string): number | null {
  const tkm = /(\d{1,3}(?:[.,]\d)?)\s*t\s*(?:is\.?\s*)?km\b/i.exec(text);
  if (tkm?.[1]) {
    const n = Number(tkm[1].replace(",", "."));
    return Math.round(n * 1000);
  }
  const km = /(\d[\d\s]{2,7})\s*km\b/i.exec(text);
  if (km?.[1]) {
    const digits = km[1].replace(/\s/g, "");
    const n = Number(digits);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Extracts engine power in kW from free text, e.g. "150 kW", "85kW". */
export function extractPowerKw(text: string): number | null {
  const m = /(\d{2,3})\s*kw\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

const DIESEL_HINT_RE = /\b(tdi|hdi|cdi|dci|crdi|d4d|bluetec|blue-?hdi|multijet|dtec)\b/i;
const PETROL_HINT_RE = /\b(tsi|tfsi|fsi|mpi|vti|vvt-?i|gdi|thp)\b/i;

/**
 * Best-effort fuel type from free text: tries exact enum aliases first
 * (benzín/nafta/elektro/...), then common engine-code hints (TDI -> diesel,
 * TSI -> petrol), then explicit LPG/CNG mentions.
 */
export function guessFuel(text: string): FuelType | null {
  const exact = parseFuelType(text);
  if (exact) return exact;
  if (/\blpg\b/i.test(text)) return "lpg";
  if (/\bcng\b|zemní plyn/i.test(text)) return "cng";
  if (/plug-?in|phev/i.test(text)) return "plugin_hybrid";
  if (/hybrid/i.test(text)) return "hybrid";
  if (/elektro|electric|\bev\b/i.test(text)) return "electric";
  if (DIESEL_HINT_RE.test(text)) return "diesel";
  if (PETROL_HINT_RE.test(text)) return "petrol";
  return null;
}

// Note: no trailing `\b` on "automat"/"manuál" — Czech inflects them
// ("automatická", "manuální") so the boundary would never follow the stem.
const AUTOMATIC_HINT_RE =
  /\b(dsg|automat|tiptronic|s-?tronic|powershift|multitronic|cvt|aut\.\s*p[řr]evodovka)/i;
const MANUAL_HINT_RE = /\b(manuál|manual|5-?stup|6-?stup|man\.\s*p[řr]evodovka)/i;

/** Best-effort transmission from free text. */
export function guessTransmission(text: string): TransmissionType | null {
  const exact = parseTransmissionType(text);
  if (exact) return exact;
  if (AUTOMATIC_HINT_RE.test(text)) return "automatic";
  if (MANUAL_HINT_RE.test(text)) return "manual";
  return null;
}

/**
 * Heuristic for dropping non-car junk (spare parts, accessories, tuning
 * bits) that slips into unfiltered category search results: very cheap and
 * with no year/mileage extracted at all is very unlikely to be an actual
 * car for sale.
 */
export function looksLikeJunkListing(
  price: number | null,
  year: number | null,
  mileageKm: number | null
): boolean {
  if (year != null || mileageKm != null) return false;
  return price != null && price < 10_000;
}

/** Parses a Czech-formatted number ("148 000", possibly with a non-breaking space, or "148,000") to an integer. */
export function parseCzNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}
