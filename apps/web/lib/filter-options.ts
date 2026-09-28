/**
 * Preset step values for the "click, don't type" numeric filters, styled
 * after mobile.de / AutoScout24 style dropdowns (price/year/mileage/power in
 * coarse steps instead of free-text fields).
 */

export const PRICE_STEPS: number[] = [
  50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 350_000, 400_000, 450_000, 500_000,
  600_000, 700_000, 800_000, 900_000, 1_000_000, 1_200_000, 1_400_000, 1_600_000, 1_800_000,
  2_000_000,
];

const CURRENT_YEAR = new Date().getFullYear();
export const YEAR_STEPS: number[] = Array.from(
  { length: CURRENT_YEAR - 1990 + 1 },
  (_, i) => CURRENT_YEAR - i
);

export const MILEAGE_STEPS: number[] = [
  10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 125_000,
  150_000, 175_000, 200_000, 250_000, 300_000,
];

export const POWER_STEPS: number[] = [
  50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 250, 300,
];

export function formatPriceStep(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} mil. Kč`;
  }
  return `${(value / 1000).toLocaleString("cs-CZ")} 000 Kč`;
}

export function formatMileageStep(value: number): string {
  return `${value.toLocaleString("cs-CZ")} km`;
}

export function formatPowerStep(value: number): string {
  return `${value} kW`;
}

export type SortKey = "newest" | "price_asc" | "price_desc" | "mileage_asc" | "year_desc";

export const SORT_LABELS: Record<SortKey, string> = {
  newest: "Nejnovější",
  price_asc: "Nejlevnější",
  price_desc: "Nejdražší",
  mileage_asc: "Nejnižší nájezd",
  year_desc: "Nejnovější rok",
};

export const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];
