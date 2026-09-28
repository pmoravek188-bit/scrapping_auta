/**
 * Das WeltAuto (dasweltauto.cz) adapter — UNVERIFIED (best-guess; sandbox
 * cannot reach dasweltauto.cz). Certified used cars from VW Group dealers,
 * server-rendered listing grid parsed with cheerio.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const BASE_URL = "https://www.dasweltauto.cz";

export function buildDasWeltAutoUrl(query: SearchQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.make) params.set("make", query.make);
  if (query.model) params.set("model", query.model);
  if (query.priceFrom) params.set("priceFrom", String(query.priceFrom));
  if (query.priceTo) params.set("priceTo", String(query.priceTo));
  if (query.yearFrom) params.set("yearFrom", String(query.yearFrom));
  if (query.yearTo) params.set("yearTo", String(query.yearTo));
  params.set("page", String(page + 1));
  return `${BASE_URL}/vyhledavani?${params.toString()}`;
}

export function parseDasWeltAutoHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $(".vehicle-card, .car-card, article.car").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a").first();
    const href = linkEl.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/[/-](\d+)(?:[/?].*)?$/);
    const sourceId = idMatch?.[1] ?? href;

    const title = $el.find(".vehicle-title, .car-title, h2, h3").first().text().trim();
    const priceText = $el.find(".price, .vehicle-price").first().text().trim();
    const mileageText = $el.find(".mileage").first().text().trim();
    const yearText = $el.find(".year, .registration").first().text().trim();
    const fuelText = $el.find(".fuel").first().text().trim();
    const transmissionText = $el.find(".gearbox, .transmission").first().text().trim();

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
      transmission: transmissionText || null,
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

export const dasweltautoAdapter: SourceAdapter = {
  id: "dasweltauto",
  verified: false,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildDasWeltAutoUrl(query, page);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[dasweltauto] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseDasWeltAutoHtml(html);
      out.push(...items);
      if (items.length === 0) break;
    }
    console.log(`[dasweltauto] fetched ${out.length} listings`);
    return out;
  },
};
