/**
 * Bazoš (auto.bazos.cz) adapter — UNVERIFIED (best-guess from public
 * knowledge of Bazoš's classic server-rendered HTML markup; this sandbox
 * cannot reach bazos.cz to confirm exact class names). Bazoš has no JSON API,
 * so we parse the HTML listing page with cheerio, defensively.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const BASE_URL = "https://auto.bazos.cz";
const PAGE_SIZE = 20;

export function buildBazosUrl(query: SearchQuery, offset: number): string {
  const params = new URLSearchParams();
  const keywords = [query.make, query.model].filter(Boolean).join(" ");
  if (keywords) params.set("hledat", keywords);
  params.set("rubriky", "auto");
  if (query.priceFrom) params.set("cenaod", String(query.priceFrom));
  if (query.priceTo) params.set("cenado", String(query.priceTo));
  params.set("order", "");
  params.set("crp", String(offset));
  return `${BASE_URL}/?${params.toString()}`;
}

export function parseBazosHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $(".inzeraty, .inzeratyflex").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("h2.nadpis a, .nadpis a").first();
    const href = linkEl.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/\/(\d+)\/[^/]*$/) ?? href.match(/\/(\d+)\/?$/);
    const sourceId = idMatch?.[1] ?? href;

    const title = linkEl.text().trim();
    const priceText = $el.find(".inzeratycena, .cena").first().text().trim();
    const price = parsePriceCzk(priceText);
    const location = $el.find(".inzeratylok, .lokalita").first().text().trim() || null;
    const description = $el.find(".popis, .inzeratydesc").first().text().trim();

    out.push({
      sourceId,
      url,
      title,
      make: null,
      model: null,
      variant: description || null,
      year: extractYear(title + " " + description),
      mileageKm: extractMileage(description),
      price,
      currency: "CZK",
      fuel: null,
      transmission: null,
      powerKw: null,
      body: null,
      color: null,
      location,
      country: "CZ",
      sellerType: "private",
      vin: null,
      imageUrls: [],
    });
  });

  return out;
}

function parsePriceCzk(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) return null;
  return Number(digits);
}

function extractYear(text: string): number | null {
  const m = text.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : null;
}

function extractMileage(text: string): number | null {
  const m = text.match(/(\d[\d\s]{2,7})\s*km/i);
  if (!m?.[1]) return null;
  return Number(m[1].replace(/\s/g, ""));
}

export const bazosAdapter: SourceAdapter = {
  id: "bazos",
  verified: false,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildBazosUrl(query, page * PAGE_SIZE);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[bazos] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseBazosHtml(html);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    console.log(`[bazos] fetched ${out.length} listings`);
    return out;
  },
};
