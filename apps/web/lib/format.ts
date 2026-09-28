export function formatCzk(value: number | null | undefined): string {
  if (value == null) return "neuvedeno";
  return `${value.toLocaleString("cs-CZ")} Kč`;
}

export function formatKm(value: number | null | undefined): string {
  if (value == null) return "neuvedeno";
  return `${value.toLocaleString("cs-CZ")} km`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString("cs-CZ");
}

export const FUEL_LABELS: Record<string, string> = {
  petrol: "Benzín",
  diesel: "Nafta",
  electric: "Elektro",
  hybrid: "Hybrid",
  plugin_hybrid: "Plug-in hybrid",
  lpg: "LPG",
  cng: "CNG",
  other: "Jiné",
};

export const TRANSMISSION_LABELS: Record<string, string> = {
  manual: "Manuální",
  automatic: "Automatická",
};

export const DRIVE_LABELS: Record<string, string> = {
  awd: "4x4 / AWD",
  fwd: "Přední",
  rwd: "Zadní",
};

export const BODY_LABELS: Record<string, string> = {
  hatchback: "Hatchback",
  sedan: "Sedan",
  combi: "Kombi",
  suv: "SUV",
  coupe: "Kupé",
  van: "Dodávka",
  pickup: "Pickup",
  cabrio: "Kabriolet",
  mpv: "MPV",
  other: "Jiné",
};
