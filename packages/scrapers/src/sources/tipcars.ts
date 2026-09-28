/**
 * TipCars.com adapter — UNVERIFIED (best-guess; sandbox cannot reach
 * tipcars.com). TipCars is server-rendered HTML with a dealer-heavy listing
 * grid, so we parse with cheerio using generic, defensive selectors.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const BASE_URL = "https://www.tipcars.com";

export function buildTipCarsUrl(query: SearchQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.make) params.set("znacka", query.make);
  if (query.model) params.set("model", query.model);
  if (query.yearFrom) params.set("rok-od", String(query.yearFrom));
  if (query.yearTo) params.set("rok-do", String(query.yearTo));
  if (query.priceFrom) params.set("cena-od", String(query.priceFrom));
  if (query.priceTo) params.set("cena-do", String(query.priceTo));
  if (query.mileageMax) params.set("najezd-do", String(query.mileageMax));
  params.set("strana", String(page + 1));
  return `${BASE_URL}/inzerce/osobni-vozy/?${params.toString()}`;
}

export function parseTipCarsHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $(".vehicle-item, .car-item, article.listing-item").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a").first();
    const href = linkEl.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/-(\d+)(?:\.html)?\/?$/);
    const sourceId = idMatch?.[1] ?? href;

    const title =
      $el.find(".vehicle-title, .title, h2, h3").first().text().trim() || linkEl.text().trim();
    const priceText = $el.find(".price, .vehicle-price").first().text().trim();
    const price = parsePriceCzk(priceText);
    const yearText = $el.find(".year, .vehicle-year").first().text().trim();
    const mileageText = $el.find(".mileage, .vehicle-mileage").first().text().trim();
    const fuelText = $el.find(".fuel, .vehicle-fuel").first().text().trim();
    const location = $el.find(".location, .vehicle-location").first().text().trim() || null;

    out.push({
      sourceId,
      url,
      title,
      make: null,
      model: null,
      variant: null,
      year: parseYear(yearText) ?? extractYear(title),
      mileageKm: parseMileage(mileageText),
      price,
      currency: "CZK",
      fuel: fuelText || null,
      transmission: null,
      powerKw: null,
      body: null,
      color: null,
      location,
      country: "CZ",
      sellerType: "dealer",
      vin: null,
      imageUrls: [],
    });
  });

  return out;
}

function parsePriceCzk(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}
function parseYear(text: string): number | null {
  const m = text.match(/\d{4}/);
  return m ? Number(m[0]) : null;
}
function extractYear(text: string): number | null {
  const m = text.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : null;
}
function parseMileage(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

export const tipcarsAdapter: SourceAdapter = {
  id: "tipcars",
  verified: false,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildTipCarsUrl(query, page);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[tipcars] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseTipCarsHtml(html);
      out.push(...items);
      if (items.length === 0) break;
    }
    console.log(`[tipcars] fetched ${out.length} listings`);
    return out;
  },
};
