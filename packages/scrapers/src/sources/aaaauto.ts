/**
 * AAA Auto (aaaauto.cz) adapter — UNVERIFIED (best-guess; sandbox cannot
 * reach aaaauto.cz). Largest used-car dealer network in CZ; server-rendered
 * listing grid parsed with cheerio.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const BASE_URL = "https://www.aaaauto.cz";

export function buildAaaAutoUrl(query: SearchQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.make) params.set("brand", query.make);
  if (query.model) params.set("model", query.model);
  if (query.priceFrom) params.set("price-from", String(query.priceFrom));
  if (query.priceTo) params.set("price-to", String(query.priceTo));
  if (query.yearFrom) params.set("year-from", String(query.yearFrom));
  if (query.yearTo) params.set("year-to", String(query.yearTo));
  if (query.mileageMax) params.set("mileage-to", String(query.mileageMax));
  params.set("page", String(page + 1));
  return `${BASE_URL}/vozy?${params.toString()}`;
}

export function parseAaaAutoHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $(".car-tile, .vehicle-tile, article.car-item").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a").first();
    const href = linkEl.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/[/-](\d+)(?:[/?].*)?$/);
    const sourceId = idMatch?.[1] ?? href;

    const title = $el.find(".car-title, h2, h3").first().text().trim();
    const priceText = $el.find(".price").first().text().trim();
    const mileageText = $el.find(".mileage").first().text().trim();
    const yearText = $el.find(".year").first().text().trim();
    const fuelText = $el.find(".fuel").first().text().trim();

    out.push({
      sourceId,
      url,
      title,
      make: null,
      model: null,
      variant: null,
      year: parseYear(yearText),
      mileageKm: parseNumber(mileageText),
      price: parseNumber(priceText),
      currency: "CZK",
      fuel: fuelText || null,
      transmission: null,
      powerKw: null,
      body: null,
      color: null,
      location: null,
      country: "CZ",
      sellerType: "dealer",
      vin: null,
      imageUrls: [],
    });
  });

  return out;
}

function parseNumber(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}
function parseYear(text: string): number | null {
  const m = text.match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

export const aaaautoAdapter: SourceAdapter = {
  id: "aaaauto",
  verified: false,
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
      if (items.length === 0) break;
    }
    console.log(`[aaaauto] fetched ${out.length} listings`);
    return out;
  },
};
