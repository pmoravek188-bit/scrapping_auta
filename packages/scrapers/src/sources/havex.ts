/**
 * Havex.cz adapter — VERIFIED live 2026-09-28.
 *
 * The old stub used `makeGenericHtmlAdapter` with selectors
 * (`.car-item, .vehicle-card`) that don't exist on the real site, hence 0
 * results. Havex (a Škoda/SEAT/Cupra dealer group; note `x-powered-by:
 * modul-is.cz`, the Seznam/Sauto dealer-site platform) serves plain
 * server-rendered HTML, no JSON API found:
 *
 *   - `https://www.havex.cz/cz/ojete-vozy` — all used cars.
 *   - `https://www.havex.cz/cz/ojete-vozy-<brand>` — one brand, confirmed
 *     live for `skoda`, `seat`, `cupra` (the only brands Havex sells).
 *   - Pagination: `?page=<n>` (1-based), confirmed live.
 *
 * The filter sidebar (price/year/km/fuel) posts back through a Nette AJAX
 * snippet (`_do=filterForm-form-submit`), not plain GET params, so those
 * are left to the client-side matcher; only the brand is filtered
 * server-side via the URL path.
 *
 * Each card is `.carItem` containing `a.carLink[href]` (id is the leading
 * number in the last URL segment, e.g.
 * `/cz/detail/528453-skoda-fabia-1-9-tdi-rs`), `.carHeader` (make+model),
 * `.carTitle` (variant/engine), `.carPrice` (price), and a `<table>` of
 * label/value rows confirmed to always use these exact Czech labels:
 * "Palivo" (fuel), "Převodovka" (transmission), "V provozu od" (year) and
 * "Nájezd" (mileage km).
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { normalizeMake } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { guessFuel, guessTransmission, parseCzNumber } from "./_util-b.js";

const BASE_URL = "https://www.havex.cz";

/** The only brands Havex sells (confirmed from its own nav / brand-scoped listing paths). */
const MAKE_PATH_SUFFIX: Record<string, string> = {
  skoda: "skoda",
  seat: "seat",
  cupra: "cupra",
};

export function buildHavexUrl(query: SearchQuery, page: number): string {
  const normalizedMake = normalizeMake(query.make);
  const suffix = normalizedMake ? MAKE_PATH_SUFFIX[normalizedMake] : undefined;
  const path = suffix ? `/cz/ojete-vozy-${suffix}` : "/cz/ojete-vozy";
  const params = new URLSearchParams();
  if (page > 0) params.set("page", String(page + 1));
  const qs = params.toString();
  return qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
}

export function parseHavexHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $(".carItem").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a.carLink").first();
    const href = linkEl.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/\/(\d+)-/);
    const sourceId = idMatch?.[1] ?? href;

    const header = $el.find(".carHeader").first().text().trim();
    const variant = $el.find(".carTitle").first().text().trim();
    const price = parseCzNumber($el.find(".carPrice").first().text());

    let fuelText = "";
    let transmissionText = "";
    let year: number | null = null;
    let mileageKm: number | null = null;
    $el.find("table tr").each((__, rowEl) => {
      const $row = $(rowEl);
      const key = $row.find(".key").text().trim().replace(/\s+/g, " ");
      const value = $row.find(".value").text().trim();
      if (key.startsWith("Palivo")) fuelText = value;
      else if (key.startsWith("Převodovka")) transmissionText = value;
      else if (key.startsWith("V provozu od")) year = /^\d{4}$/.test(value) ? Number(value) : null;
      else if (key.startsWith("Nájezd")) mileageKm = parseCzNumber(value);
    });

    out.push({
      sourceId,
      url,
      title: [header, variant].filter(Boolean).join(" "),
      make: header || null,
      model: null,
      variant: variant || null,
      year,
      mileageKm,
      price,
      currency: "CZK",
      fuel: guessFuel(fuelText),
      transmission: guessTransmission(transmissionText),
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

export const havexAdapter: SourceAdapter = {
  id: "havex",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildHavexUrl(query, page);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[havex] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseHavexHtml(html);
      out.push(...items);
      if (items.length === 0) break;
    }
    console.log(`[havex] fetched ${out.length} listings`);
    return out;
  },
};
