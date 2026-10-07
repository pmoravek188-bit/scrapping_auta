/**
 * Das WeltAuto (dasweltauto.cz) adapter — VERIFIED live 2026-09-28.
 *
 * The old guess (`GET /vyhledavani?page=1`) 404s — that path doesn't exist.
 * dasweltauto.cz is an Angular app; its search page (`/search`) hydrates
 * from a JSON API that is directly callable with no auth/cookies:
 *
 *   GET https://www.dasweltauto.cz/api/locales/cs_CZ/vehicles/search/
 *       ?page=1&pageSize=20&brands=skoda&minPrice=...&maxPrice=...
 *       &fromInitialRegistrationYear=...&toInitialRegistrationYear=...
 *       &maxMileage=...
 *
 * Confirmed live: response is
 * `{ count, resultListPage: { number, size, content: [...] } }`, each
 * `content[]` item has `id.fiveDigitsDealerId`/`id.fiveDigitsVehicleId`,
 * `brand`, `modelVariant`, `price`, `mileage`, `registration` ("YYYY-MM-DD"),
 * `fuelText`, `transmission`, `powerKw`, `bodyType`, `vin`, `dealer.city`,
 * `imageUrls`.
 *
 * Detail page URL (confirmed 200): `/vehicle/<fiveDigitsDealerId><fiveDigitsVehicleId>`
 * (both zero-padded to 5 digits and concatenated, no separator) — found by
 * cross-referencing the numeric ids linked from a rendered model page
 * (`/s/skoda/skoda-fabia`) against the API's `id` object.
 *
 * `brands` filter values (confirmed via the API's own `searchItems.brands`
 * facet list) mostly match `@scrapping-auta/core`'s canonical make slugs,
 * except Volkswagen (`vw`, not `volkswagen`) and Mercedes-Benz (`mercedes`,
 * not `mercedes-benz`) — see `MAKE_TO_DWA_BRAND`.
 */
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { normalizeMake } from "@scrapping-auta/core";
import { fetchJson, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { guessFuel, guessTransmission } from "./_util-b.js";

const BASE_URL = "https://www.dasweltauto.cz";
const PAGE_SIZE = 20;

const MAKE_TO_DWA_BRAND: Record<string, string> = {
  volkswagen: "vw",
  "mercedes-benz": "mercedes",
};

interface DwaVehicleId {
  fiveDigitsDealerId?: string;
  fiveDigitsVehicleId?: string;
}

interface DwaDealer {
  name?: string | null;
  city?: string | null;
}

interface DwaVehicle {
  id?: DwaVehicleId;
  imageUrls?: string[] | null;
  price?: number | null;
  powerKw?: number | null;
  modelVariant?: string | null;
  mileage?: number | null;
  registration?: string | null;
  dealer?: DwaDealer | null;
  brand?: string | null;
  fuelText?: string | null;
  transmission?: string | null;
  bodyType?: string | null;
  vin?: string | null;
}

interface DwaSearchResponse {
  count?: number;
  resultListPage?: {
    number?: number;
    size?: number;
    content?: DwaVehicle[];
  };
}

export function buildDasWeltAutoUrl(query: SearchQuery, page: number): string {
  const params = new URLSearchParams();
  params.set("page", String(page + 1));
  params.set("pageSize", String(PAGE_SIZE));

  const normalizedMake = normalizeMake(query.make);
  if (normalizedMake) {
    const brand = MAKE_TO_DWA_BRAND[normalizedMake] ?? normalizedMake;
    params.set("brands", brand);
  }
  if (query.priceFrom) params.set("minPrice", String(query.priceFrom));
  if (query.priceTo) params.set("maxPrice", String(query.priceTo));
  if (query.yearFrom) params.set("fromInitialRegistrationYear", String(query.yearFrom));
  if (query.yearTo) params.set("toInitialRegistrationYear", String(query.yearTo));
  if (query.mileageMax) params.set("maxMileage", String(query.mileageMax));

  return `${BASE_URL}/api/locales/cs_CZ/vehicles/search/?${params.toString()}`;
}

function yearFromDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})/.exec(dateStr);
  return m ? Number(m[1]) : null;
}

export function parseDasWeltAutoResponse(data: DwaSearchResponse): RawListing[] {
  const content = data.resultListPage?.content ?? [];
  const out: RawListing[] = [];

  for (const v of content) {
    const dealerId = v.id?.fiveDigitsDealerId;
    const vehicleId = v.id?.fiveDigitsVehicleId;
    if (!dealerId || !vehicleId) continue;
    const sourceId = `${dealerId}${vehicleId}`;
    const url = `${BASE_URL}/vehicle/${sourceId}`;

    const fuelText = v.fuelText ?? "";
    const transmissionText = v.transmission ?? "";

    out.push({
      sourceId,
      url,
      title: v.modelVariant ?? [v.brand, v.modelVariant].filter(Boolean).join(" "),
      make: v.brand ?? null,
      model: null,
      variant: v.modelVariant ?? null,
      year: yearFromDate(v.registration),
      mileageKm: typeof v.mileage === "number" ? v.mileage : null,
      price: typeof v.price === "number" ? v.price : null,
      currency: "CZK",
      fuel: guessFuel(fuelText),
      transmission: guessTransmission(transmissionText),
      powerKw: typeof v.powerKw === "number" ? v.powerKw : null,
      body: null,
      color: null,
      location: v.dealer?.city ?? null,
      country: "CZ",
      sellerType: "dealer",
      vin: v.vin ?? null,
      imageUrls: v.imageUrls ?? [],
    });
  }

  return out;
}

export const dasweltautoAdapter: SourceAdapter = {
  id: "dasweltauto",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    let hitCap = false;
    for (let page = 0; page < maxPages; page++) {
      const url = buildDasWeltAutoUrl(query, page);
      let data: DwaSearchResponse;
      try {
        data = await fetchJson<DwaSearchResponse>(url);
      } catch (err) {
        console.warn(`[dasweltauto] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseDasWeltAutoResponse(data);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
      if (page === maxPages - 1) hitCap = true;
    }
    if (hitCap) ctx.onPageCapHit?.();
    console.log(`[dasweltauto] fetched ${out.length} listings`);
    return out;
  },
};
