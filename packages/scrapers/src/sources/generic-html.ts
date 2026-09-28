/**
 * Shared factory for simple, generic-selector HTML adapters used by
 * lower-priority / not-yet-confident sources (Havex, Auto ESA, Škoda Plus).
 * These are registered but disabled by default in the `sources` seed until
 * someone verifies the real markup against the live site.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

export interface GenericHtmlSourceConfig {
  id: string;
  baseUrl: string;
  searchPath: string;
  itemSelector: string;
  buildParams?: (query: SearchQuery, page: number) => URLSearchParams;
}

export function makeGenericHtmlAdapter(cfg: GenericHtmlSourceConfig): SourceAdapter {
  return {
    id: cfg.id,
    verified: false,
    async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
      const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
      const out: RawListing[] = [];
      for (let page = 0; page < maxPages; page++) {
        const params = cfg.buildParams
          ? cfg.buildParams(query, page)
          : new URLSearchParams({ page: String(page + 1) });
        const url = `${cfg.baseUrl}${cfg.searchPath}?${params.toString()}`;
        let html: string;
        try {
          html = await fetchText(url);
        } catch (err) {
          console.warn(`[${cfg.id}] request failed on page ${page}:`, (err as Error).message);
          break;
        }
        const items = parseGenericHtml(html, cfg);
        out.push(...items);
        if (items.length === 0) break;
      }
      console.log(`[${cfg.id}] fetched ${out.length} listings`);
      return out;
    },
  };
}

export function parseGenericHtml(html: string, cfg: GenericHtmlSourceConfig): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];
  $(cfg.itemSelector).each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a").first();
    const href = linkEl.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${cfg.baseUrl}${href}`;
    const idMatch = href.match(/[/-](\d+)(?:[/?].*)?$/);
    const sourceId = idMatch?.[1] ?? href;
    const title = $el.find("h2, h3, .title").first().text().trim() || linkEl.text().trim();
    const priceText = $el.find(".price").first().text().trim();
    const digits = priceText.replace(/[^\d]/g, "");

    out.push({
      sourceId,
      url,
      title,
      make: null,
      model: null,
      variant: null,
      year: null,
      mileageKm: null,
      price: digits ? Number(digits) : null,
      currency: "CZK",
      fuel: null,
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
