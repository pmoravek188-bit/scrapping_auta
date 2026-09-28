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
