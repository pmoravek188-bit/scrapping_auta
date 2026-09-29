/**
 * Carvago.com adapter — VERIFIED live 2026-09-28.
 *
 * The old guess (`POST https://api.carvago.com/v2/vehicles/search`) 404s —
 * that host doesn't resolve to a search API at all. Carvago's real frontend
 * lives at `https://carvago.com` (no `www`, note the domain redirects
 * `www.carvago.com` -> a 404 page) under the `/cs` (Czech) locale, and the
 * search page `https://carvago.com/cs/auta` is a Next.js SSR page that
 * embeds the *entire* first page of results as JSON in
 * `<script id="__NEXT_DATA__">` — no separate API call needed, no headless
 * browser needed.
 *
 * Confirmed live:
 * - `props.pageProps.searchResults` = `{ total, cars: [...] }`.
 * - Each `car` has `id`, `slug`, `title`, `make`/`model` as
 *   `{const_key, label}`, `price` (number) + `price_currency.name`,
 *   `mileage` (km), `power` (always `power_unit: "kW"`),
 *   `registration_date`/`manufacture_date` ("YYYY-MM-DD" or null),
 *   `location_city`, `main_image` (absolute URL), `vin`,
 *   `seller.type.const_key` (every car seen was
 *   `SELLERTYPE_PARTNER_DEALERSHIP` — Carvago is a dealer-import
 *   aggregator, no private listings), and `catalog_features`: an array of
 *   `{const_key, label}` tags that includes the fuel type (`FUELTYPE_*`),
 *   body style (`CARSTYLE_*`) and transmission (`TRANSMISSION_MANUAL` /
 *   `TRANSMISSION_AUTOMATIC`) — there's no dedicated top-level field for
 *   those, they have to be picked out of this tag list.
 * - Detail URL: `https://carvago.com/cs/auto/{id}/{slug}` (confirmed 200).
 * - Server-side filtering confirmed live via `numberOfItems`/`total`
 *   changing between requests: path segments `/cs/auta/{makeSlug}` and
 *   `/cs/auta/{makeSlug}/{modelSlug}`; query params `price-from`,
 *   `price-to`, `mileage-to`, `registration-date-from`,
 *   `registration-date-to`, `power-from`, `page`, `limit`, and the
 *   filter-tag params `fuel-type[]=FUELTYPE_*`, `transmission[]=TRANSMISSION_*`,
 *   `karoserie[]=CARSTYLE_*` (these 308-redirect to a canonicalized path
 *   like `/cs/auta/skoda/octavia/diesel` — `fetch` follows redirects
 *   automatically so this is transparent).
 *
 * Mercedes-Benz lettered classes: unlike sauto/tipcars/autoscout24/aaaauto,
 * carvago has NO single model slug that groups a whole class — confirmed
 * live that `/cs/auta/mercedes-benz/v-class`, `/v-klasse` and `/trida-v` all
 * silently redirect back to the unfiltered `/cs/auta/mercedes-benz` (same
 * ~81k `total` as no model filter at all), because carvago's actual model
 * catalog only has individual engine variants (`v-300`, `v-250`, `c-180`,
 * ... — each of those DOES filter correctly, confirmed live). Since we only
 * know the class, not the variant, the model path segment is simply omitted
 * for these — the make filter still applies, and the runner's client-side
 * `matchesSearch` narrows the rest, same as it always does.
 */
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import type { FuelType, TransmissionType } from "@scrapping-auta/core";
import { mercedesClassLetter, normalizeMake, slugifyMakeModel } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const BASE_URL = "https://carvago.com";
const PAGE_SIZE = 20;

const FUEL_CONST_KEY_MAP: Partial<Record<FuelType, string>> = {
  petrol: "FUELTYPE_PETROL",
  diesel: "FUELTYPE_DIESEL",
  electric: "FUELTYPE_ELECTRIC",
  hybrid: "FUELTYPE_HYBRID",
  lpg: "FUELTYPE_LPG",
  cng: "FUELTYPE_CNG",
  other: "FUELTYPE_OTHER",
  // plugin_hybrid is a separate "hybrid_type" sub-filter on carvago, not a
  // top-level fuel-type value — omitted, left to the client-side matcher.
};

const TRANSMISSION_CONST_KEY_MAP: Record<TransmissionType, string> = {
  manual: "TRANSMISSION_MANUAL",
  automatic: "TRANSMISSION_AUTOMATIC",
};

const BODY_CONST_KEY_MAP: Partial<Record<string, string>> = {
  hatchback: "CARSTYLE_HATCHBACK",
  sedan: "CARSTYLE_SEDANS_SALOONS",
  combi: "CARSTYLE_ESTATE_CAR",
  suv: "CARSTYLE_SUV_OFFROAD",
  coupe: "CARSTYLE_COUPE",
  van: "CARSTYLE_VAN",
  pickup: "CARSTYLE_PICK_UP",
  cabrio: "CARSTYLE_CABRIOLET",
  mpv: "CARSTYLE_MPV",
};

// Reverse maps: catalog_features const_key -> canonical token accepted by
// FUEL_ALIASES/BODY_ALIASES/TRANSMISSION_ALIASES in @scrapping-auta/core.
const FUEL_KEY_TO_CANONICAL: Record<string, string> = {
  FUELTYPE_PETROL: "petrol",
  FUELTYPE_DIESEL: "diesel",
  FUELTYPE_ELECTRIC: "electric",
  FUELTYPE_HYBRID: "hybrid",
  FUELTYPE_LPG: "lpg",
  FUELTYPE_CNG: "cng",
};
const BODY_KEY_TO_CANONICAL: Record<string, string> = {
  CARSTYLE_HATCHBACK: "hatchback",
  CARSTYLE_SEDANS_SALOONS: "sedan",
  CARSTYLE_ESTATE_CAR: "combi",
  CARSTYLE_SUV_OFFROAD: "suv",
  CARSTYLE_COUPE: "coupe",
  CARSTYLE_VAN: "van",
  CARSTYLE_PICK_UP: "pickup",
  CARSTYLE_CABRIOLET: "cabrio",
  CARSTYLE_MPV: "mpv",
};
const TRANSMISSION_KEY_TO_CANONICAL: Record<string, string> = {
  TRANSMISSION_MANUAL: "manual",
  TRANSMISSION_AUTOMATIC: "automatic",
};
// Confirmed live in `catalog_features`: DRIVE_4X4 / DRIVE_4X2 (front/rear,
// not distinguished at this level). Only the unambiguous 4x4 case is mapped
// to our DriveType — DRIVE_4X2 is deliberately left unmapped (null) rather
// than guessed as fwd/rwd.
const DRIVE_KEY_TO_CANONICAL: Record<string, string> = {
  DRIVE_4X4: "awd",
};
// A handful of catalog_features FEATURE_* keys map directly onto our
// equipment chip groups (see @scrapping-auta/core's FEATURE_GROUPS) — passed
// through as free text via `equipment` so the matcher's title/variant/
// equipment token search picks them up without needing a 1:1 id mapping.
const FEATURE_KEY_TO_LABEL: Record<string, string> = {
  FEATURE_TRAILERCOUPLING: "tažné zařízení",
  FEATURE_THIRD_ROW_SEATS: "7 míst",
};

export function buildCarvagoUrl(query: SearchQuery, page: number): string {
  let path = "/cs/auta";
  if (query.make) {
    path += `/${slugifyMakeModel(query.make)}`;
    const isUnmappableMercedesClass =
      query.model != null &&
      normalizeMake(query.make) === "mercedes-benz" &&
      mercedesClassLetter(query.model) != null;
    if (query.model && !isUnmappableMercedesClass) path += `/${slugifyMakeModel(query.model)}`;
  }
  const params = new URLSearchParams();
  params.set("page", String(page + 1));
  params.set("limit", String(PAGE_SIZE));
  if (query.priceFrom) params.set("price-from", String(query.priceFrom));
  if (query.priceTo) params.set("price-to", String(query.priceTo));
  if (query.mileageMax) params.set("mileage-to", String(query.mileageMax));
  if (query.yearFrom) params.set("registration-date-from", String(query.yearFrom));
  if (query.yearTo) params.set("registration-date-to", String(query.yearTo));
  if (query.powerMinKw) params.set("power-from", String(query.powerMinKw));
  const fuelFilter = query.fuel[0];
  if (query.fuel.length === 1 && fuelFilter) {
    const key = FUEL_CONST_KEY_MAP[fuelFilter];
    if (key) params.set("fuel-type[]", key);
  }
  if (query.transmission) {
    params.set("transmission[]", TRANSMISSION_CONST_KEY_MAP[query.transmission]);
  }
  const bodyFilter = query.body[0];
  if (query.body.length === 1 && bodyFilter) {
    const key = BODY_CONST_KEY_MAP[bodyFilter];
    if (key) params.set("karoserie[]", key);
  }
  return `${BASE_URL}${path}?${params.toString()}`;
}

interface CarvagoCar {
  id?: string | number;
  slug?: string;
  title?: string;
  vin?: string | null;
  power?: number | null;
  mileage?: number | null;
  registration_date?: string | null;
  manufacture_date?: string | null;
  price?: number | null;
  price_currency?: { name?: string } | null;
  location_city?: string | null;
  main_image?: string | null;
  make?: { label?: string } | null;
  model?: { label?: string } | null;
  seller?: { type?: { const_key?: string } | null } | null;
  catalog_features?: Array<{ const_key?: string }> | null;
}

interface CarvagoNextData {
  props?: {
    pageProps?: {
      searchResults?: {
        total?: number;
        cars?: CarvagoCar[];
      };
    };
  };
}

function yearFromDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})/.exec(dateStr);
  return m ? Number(m[1]) : null;
}

function pickFeature(
  features: Array<{ const_key?: string }> | null | undefined,
  keyMap: Record<string, string>
): string | null {
  for (const f of features ?? []) {
    const mapped = f.const_key ? keyMap[f.const_key] : undefined;
    if (mapped) return mapped;
  }
  return null;
}

export function parseCarvagoHtml(html: string): RawListing[] {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  const rawJson = m?.[1];
  if (!rawJson) return [];
  let data: CarvagoNextData;
  try {
    data = JSON.parse(rawJson) as CarvagoNextData;
  } catch {
    return [];
  }
  const cars = data.props?.pageProps?.searchResults?.cars ?? [];
  const out: RawListing[] = [];
  for (const car of cars) {
    if (car.id == null || !car.slug) continue;
    const year = yearFromDate(car.registration_date) ?? yearFromDate(car.manufacture_date);
    const sellerConstKey = car.seller?.type?.const_key ?? "";
    const drive = pickFeature(car.catalog_features, DRIVE_KEY_TO_CANONICAL);
    const equipment = (car.catalog_features ?? [])
      .map((f) => (f.const_key ? FEATURE_KEY_TO_LABEL[f.const_key] : undefined))
      .filter((label): label is string => Boolean(label));
    out.push({
      sourceId: String(car.id),
      url: `${BASE_URL}/cs/auto/${car.id}/${car.slug}`,
      title: car.title ?? [car.make?.label, car.model?.label].filter(Boolean).join(" "),
      make: car.make?.label ?? null,
      model: car.model?.label ?? null,
      variant: null,
      year,
      mileageKm: car.mileage ?? null,
      price: car.price ?? null,
      currency: car.price_currency?.name ?? "CZK",
      fuel: pickFeature(car.catalog_features, FUEL_KEY_TO_CANONICAL),
      transmission: pickFeature(car.catalog_features, TRANSMISSION_KEY_TO_CANONICAL),
      powerKw: car.power ?? null,
      body: pickFeature(car.catalog_features, BODY_KEY_TO_CANONICAL),
      color: null,
      location: car.location_city ?? null,
      country: "EU",
      sellerType: sellerConstKey.includes("DEALER") ? "dealer" : "unknown",
      vin: car.vin ?? null,
      imageUrls: car.main_image ? [car.main_image] : [],
      drive,
      equipment,
    });
  }
  return out;
}

export const carvagoAdapter: SourceAdapter = {
  id: "carvago",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildCarvagoUrl(query, page);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[carvago] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseCarvagoHtml(html);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    console.log(`[carvago] fetched ${out.length} listings`);
    return out;
  },
};
