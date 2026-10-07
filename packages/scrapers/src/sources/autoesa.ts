/**
 * Auto ESA (autoesa.cz) adapter — VERIFIED live 2026-09-28.
 *
 * The old guess (`GET /vozy?page=1`) 404s. The real listing pages are:
 *   - `https://www.autoesa.cz/vsechna-auta` — whole inventory.
 *   - `https://www.autoesa.cz/<makeSlug>` — filtered to one make, e.g.
 *     `/skoda`, `/volkswagen`, `/mercedes-benz` (confirmed these slugs are
 *     exactly `@scrapping-auta/core`'s canonical `normalizeMake()` output —
 *     no alias table needed).
 *   - Pagination: `?stranka=<n>` (1-based), confirmed on both URL shapes.
 *
 * The result grid is server-rendered HTML (Nette Framework), no JSON API
 * found — the filter sidebar posts back through an AJAX snippet
 * (`_do=searchForm-submit`) rather than plain GET query params, so
 * price/year/km filtering is left to the client-side matcher; only the
 * make (via path segment) is filtered server-side.
 *
 * Each card is `a.car_item[href]` with the numeric id as the last URL
 * segment (confirmed against detail pages, e.g.
 * `/audi/a6-allroad/kombi/nafta/699459281`). Inside: `h2.car_item__title`
 * (name + a nested `<span>` with the year), `.car_item__icon.icon_year`
 * (actually the engine/variant text, e.g. "2.0TDi" — the class name is
 * misleading), `.icon_power` ("200 kW"), `.icon_fuel` ("nafta"/"benzín"/
 * "LPG + benzín"), `.icon_range` ("161 431 km"). Price: there are always
 * exactly two `.car_item__price_block`s per card — "Měsíčně od" (monthly
 * installment, skipped) and "Akční cena" (the actual price, used) —
 * confirmed 1:1 on a live page.
 * - images: previously always `[]`. Confirmed live: `.car_item__image` has
 *   a real (non-lazy) `<img src="/files/cars/<id>/950_713_e/<id>-1.jpg?...">`
 *   — a site-relative URL, made absolute against `BASE_URL`.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { normalizeMake } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { extractPowerKw, extractYear, guessFuel, parseCzNumber } from "./_util-b.js";

const BASE_URL = "https://www.autoesa.cz";

export function buildAutoEsaUrl(query: SearchQuery, page: number): string {
  const normalizedMake = normalizeMake(query.make);
  const path = normalizedMake ? `/${normalizedMake}` : "/vsechna-auta";
  const params = new URLSearchParams();
  if (page > 0) params.set("stranka", String(page + 1));
  const qs = params.toString();
  return qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
}

export function parseAutoEsaHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $("a.car_item").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/\/(\d+)$/);
    const sourceId = idMatch?.[1] ?? href;

    const titleEl = $el.find("h2.car_item__title").first();
    const yearText = titleEl.find("span").first().text().trim();
    const title = titleEl.clone().children("span").remove().end().text().trim();
    const variant = $el.find(".car_item__icon.icon_year").first().text().trim() || null;
    const powerText = $el.find(".car_item__icon.icon_power").first().text().trim();
    const fuelText = $el.find(".car_item__icon.icon_fuel").first().text().trim();
    const rangeText = $el.find(".car_item__icon.icon_range").first().text().trim();

    let price: number | null = null;
    $el.find(".car_item__price_block").each((__, blockEl) => {
      const $block = $(blockEl);
      if ($block.find(".text").text().trim() === "Akční cena") {
        price = parseCzNumber($block.find(".price").text());
      }
    });

    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : extractYear(title);

    const imgSrc = $el.find(".car_item__image img").first().attr("src");
    const imageUrls = imgSrc ? [imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`] : [];

    out.push({
      sourceId,
      url,
      title: [title, yearText].filter(Boolean).join(" "),
      make: null,
      model: null,
      variant,
      year,
      mileageKm: parseCzNumber(rangeText),
      price,
      currency: "CZK",
      fuel: guessFuel(fuelText),
      transmission: null,
      powerKw: extractPowerKw(powerText) ?? parseCzNumber(powerText),
      body: null,
      color: null,
      location: null,
      country: "CZ",
      sellerType: "dealer",
      vin: null,
      imageUrls,
    });
  });

  return out;
}

export const autoesaAdapter: SourceAdapter = {
  id: "autoesa",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    let hitCap = false;
    for (let page = 0; page < maxPages; page++) {
      const url = buildAutoEsaUrl(query, page);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[autoesa] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseAutoEsaHtml(html);
      out.push(...items);
      if (items.length === 0) break;
      if (page === maxPages - 1) hitCap = true;
    }
    if (hitCap) ctx.onPageCapHit?.();
    console.log(`[autoesa] fetched ${out.length} listings`);
    return out;
  },
};
