export const FUEL_TYPES = [
  "petrol",
  "diesel",
  "electric",
  "hybrid",
  "plugin_hybrid",
  "lpg",
  "cng",
  "other",
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const TRANSMISSION_TYPES = ["manual", "automatic"] as const;
export type TransmissionType = (typeof TRANSMISSION_TYPES)[number];

export const BODY_TYPES = [
  "hatchback",
  "sedan",
  "combi",
  "suv",
  "coupe",
  "van",
  "pickup",
  "cabrio",
  "mpv",
  "other",
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const SELLER_TYPES = ["private", "dealer", "unknown"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export const DRIVE_TYPES = ["awd", "fwd", "rwd"] as const;
export type DriveType = (typeof DRIVE_TYPES)[number];

/** Drive-type synonyms (badge names, marketing terms, Czech/German text) ->
 * canonical DriveType. Keys are matched after `normalizeEnumToken` (lowercase,
 * diacritics stripped), so e.g. "4×4" and "4x4" both hit the "4x4" key. */
export const DRIVE_ALIASES: Record<string, DriveType> = {
  "4x4": "awd",
  "4wd": "awd",
  awd: "awd",
  "4motion": "awd",
  quattro: "awd",
  xdrive: "awd",
  "4matic": "awd",
  all4: "awd",
  allgrip: "awd",
  "e-four": "awd",
  "4x4i": "awd",
  "sh-awd": "awd",
  "pohon vsech kol": "awd",
  fwd: "fwd",
  "predni pohon": "fwd",
  "pohon predni napravy": "fwd",
  rwd: "rwd",
  "zadni pohon": "rwd",
  "pohon zadni napravy": "rwd",
  // Slovak bare single-word forms (no "pohon" suffix) — confirmed live:
  // autobazar.eu's own structured `driveValue` field is literally "Predný"/
  // "Zadný" (Slovak spelling, diacritics stripped by normalizeEnumToken to
  // "predny"/"zadny"), not the Czech "přední pohon"/"zadní pohon" phrases
  // already covered above.
  predny: "fwd",
  zadny: "rwd",
};

/** Czech/Slovak diacritics-aware fuel keyword map -> canonical FuelType. */
export const FUEL_ALIASES: Record<string, FuelType> = {
  benzin: "petrol",
  benzín: "petrol",
  petrol: "petrol",
  gasoline: "petrol",
  nafta: "diesel",
  diesel: "diesel",
  elektro: "electric",
  electric: "electric",
  ev: "electric",
  hybrid: "hybrid",
  "hybridni-benzin": "hybrid",
  "plug-in hybrid": "plugin_hybrid",
  "plugin hybrid": "plugin_hybrid",
  phev: "plugin_hybrid",
  lpg: "lpg",
  cng: "cng",
};

export const TRANSMISSION_ALIASES: Record<string, TransmissionType> = {
  manualni: "manual",
  "manuální": "manual",
  manual: "manual",
  automat: "automatic",
  automaticka: "automatic",
  "automatická": "automatic",
  automatic: "automatic",
};

export const BODY_ALIASES: Record<string, BodyType> = {
  hatchback: "hatchback",
  liftback: "hatchback",
  sedan: "sedan",
  limuzina: "sedan",
  "limuzína": "sedan",
  kombi: "combi",
  combi: "combi",
  suv: "suv",
  terenni: "suv",
  "terénní": "suv",
  crossover: "suv",
  kupe: "coupe",
  "kupé": "coupe",
  coupe: "coupe",
  van: "van",
  dodavka: "van",
  "dodávka": "van",
  pickup: "pickup",
  kabriolet: "cabrio",
  cabrio: "cabrio",
  mpv: "mpv",
  vanek: "mpv",
};

export function normalizeEnumToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function parseFuelType(value: string | null | undefined): FuelType | null {
  if (!value) return null;
  const key = normalizeEnumToken(value);
  return FUEL_ALIASES[key] ?? FUEL_ALIASES[value.toLowerCase()] ?? null;
}

export function parseTransmissionType(
  value: string | null | undefined
): TransmissionType | null {
  if (!value) return null;
  const key = normalizeEnumToken(value);
  return TRANSMISSION_ALIASES[key] ?? null;
}

export function parseBodyType(value: string | null | undefined): BodyType | null {
  if (!value) return null;
  const key = normalizeEnumToken(value);
  return BODY_ALIASES[key] ?? null;
}

/** Exact-match drive-type parse (structured source field, e.g. a codebook
 * value) — for free-text title/variant scanning use `inferDrive` instead. */
export function parseDriveType(value: string | null | undefined): DriveType | null {
  if (!value) return null;
  const key = normalizeEnumToken(value);
  return DRIVE_ALIASES[key] ?? null;
}
