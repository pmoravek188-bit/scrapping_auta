/**
 * AAA Auto (aaaauto.cz) adapter — VERIFIED live 2026-09-28.
 *
 * The old guess (`/vozy?page=1`) 404s. The real used-car listing root is
 * `https://www.aaaauto.cz/ojete-vozy` with make/model path filters:
 *   - `/ojete-vozy/{makeSlug}`             e.g. `/ojete-vozy/skoda`
 *   - `/ojete-vozy/{makeSlug}/{modelSlug}` e.g. `/ojete-vozy/skoda/octavia`
 * (confirmed live by diffing the `totalItems` count embedded in the page).
 *
 * Listing pages embed the current page's cars as `Product`/`Car` items
 * inside a single `<script type="application/ld+json">` block containing an
 * `@graph` array; the `ItemList` entry in that graph has the per-item data
 * we need directly (name, brand, model, dateVehicleFirstRegistered,
 * mileageFromOdometer, fuelType, bodyType, vehicleTransmission, price,
 * image, url) — no separate API call or CSS-selector guessing required.
 * Every listing is sold by AAA AUTO itself (`seller.@id` points at the
 * single dealer org in the graph), so `sellerType` is always "dealer".
 *
 * `sku`/`productID`/`vehicleIdentificationNumber` in the JSON-LD are NOT a
 * real VIN — they're an internal stock number distinct from the id in the
 * URL (confirmed: they differ from the URL's numeric id on the same item),
 * so `vin` is left null rather than reporting a fake one; `sourceId` is
 * taken from the URL's trailing id segment instead (also used to rebuild
 * the detail URL: `https://www.aaaauto.cz/detail/{make}/{model}/{id}`).
 *
 * Pagination confirmed via `?page=N` (35 items/page, `totalItems` in an
 * inline JSON blob on the page tracks the true filtered total).
 * Server-side filters confirmed live via that `totalItems` count:
 * `priceFrom`, `priceTo`, `yearFrom`, `yearTo`, `mileageTo`. A body-type
 * filter (`bodyTypeId-array=SUV`/`MPV`) also demonstrably filters, but only
 * those two exact enum values could be confirmed — other body/fuel/
 * transmission strings tried (`Kombi`, `Sedan`, `Hatchback`, `Combi`,
 * `Saloon`, numeric `fuelTypeId`, `transmissionId-array`, ...) were silently
 * ignored (same result count as unfiltered), so they're left to the
 * runner's client-side matcher instead of guessing wrong values.
 */
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { slugifyMakeModel } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const BASE_URL = "https://www.aaaauto.cz";
const PAGE_SIZE = 35;

/** Only these two body-type filter values were confirmed to actually change
 * the live result count; everything else is left to the client matcher. */
const BODY_FILTER_MAP: Partial<Record<string, string>> = {
  suv: "SUV",
  mpv: "MPV",
};

export function buildAaaAutoUrl(query: SearchQuery, page: number): string {
  let path = "/ojete-vozy";
  if (query.make) {
    path += `/${slugifyMakeModel(query.make)}`;
    if (query.model) path += `/${slugifyMakeModel(query.model)}`;
  }
  const params = new URLSearchParams();
  params.set("page", String(page + 1));
  if (query.priceFrom) params.set("priceFrom", String(query.priceFrom));
  if (query.priceTo) params.set("priceTo", String(query.priceTo));
  if (query.yearFrom) params.set("yearFrom", String(query.yearFrom));
  if (query.yearTo) params.set("yearTo", String(query.yearTo));
  if (query.mileageMax) params.set("mileageTo", String(query.mileageMax));
  const bodyFilter = query.body[0];
  if (query.body.length === 1 && bodyFilter) {
    const val = BODY_FILTER_MAP[bodyFilter];
    if (val) params.set("bodyTypeId-array", val);
  }
  return `${BASE_URL}${path}?${params.toString()}`;
}

interface AaaCarLd {
  name?: string;
  brand?: { name?: string };
  model?: string;
  dateVehicleFirstRegistered?: string;
  mileageFromOdometer?: { value?: number };
  fuelType?: string;
  bodyType?: string;
  vehicleTransmission?: string;
  color?: string;
  image?: string[];
  offers?: { price?: number; priceCurrency?: string };
  url?: string;
}

function idFromUrl(url: string): string | null {
  const m = /\/(\d+)\/?$/.exec(url);
  return m?.[1] ?? null;
}

export function parseAaaAutoHtml(html: string): RawListing[] {
  const scripts = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  const out: RawListing[] = [];
  for (const scriptMatch of scripts) {
    const rawJson = scriptMatch[1];
    if (!rawJson) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(rawJson);
    } catch {
      continue;
    }
    const graph = (doc as { "@graph"?: unknown[] })?.["@graph"] ?? [];
    const itemList = graph.find(
      (g): g is { itemListElement?: unknown[] } =>
        typeof g === "object" && g !== null && (g as { "@type"?: string })["@type"] === "ItemList"
    );
    if (!itemList?.itemListElement) continue;

    for (const entry of itemList.itemListElement) {
      const item = (entry as { item?: AaaCarLd })?.item;
      const url = item?.url;
      if (!item || !url) continue;
      const id = idFromUrl(url);
      if (!id) continue;

      out.push({
        sourceId: id,
        url,
        title: item.name ?? "",
        make: item.brand?.name ?? null,
        model: item.model ?? null,
        variant: null,
        year: item.dateVehicleFirstRegistered ? Number(item.dateVehicleFirstRegistered) : null,
        mileageKm: item.mileageFromOdometer?.value ?? null,
        price: item.offers?.price ?? null,
        currency: item.offers?.priceCurrency ?? "CZK",
        fuel: item.fuelType ?? null,
        transmission: item.vehicleTransmission ?? null,
        powerKw: null,
        body: item.bodyType ?? null,
        color: item.color ?? null,
        location: null,
        country: "CZ",
        sellerType: "dealer",
        vin: null,
        imageUrls: item.image ?? [],
      });
    }
  }
  return out;
}

export const aaaautoAdapter: SourceAdapter = {
  id: "aaaauto",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildAaaAutoUrl(query, page);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[aaaauto] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseAaaAutoHtml(html);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    console.log(`[aaaauto] fetched ${out.length} listings`);
    return out;
  },
};
