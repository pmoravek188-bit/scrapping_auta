/**
 * Bazoš (auto.bazos.cz) adapter — VERIFIED live 2026-09-28.
 *
 * Confirmed live against auto.bazos.cz with a realistic Chrome UA +
 * cs-CZ Accept-Language:
 * - Bazoš's markup is missing a closing `</div>` after the title/
 *   description block, so `.inzeratycena` (price), `.inzeratylok`
 *   (location), `.inzeratyview` and `.inzeratyakce` all end up nested
 *   *inside* `.inzeraty.inzeratyflex` once parsed (confirmed against a
 *   real fetched page — despite the visual "5 sibling flex columns" layout
 *   in the raw HTML text, the DOM tree cheerio builds has them as
 *   descendants). `$el.find(...)` therefore does find them correctly —
 *   the previous version's price/location parsing was fine; year/mileage
 *   were the actual gap, since those aren't separate fields at all, only
 *   free text inside the title/description.
 * - "Osobní auta" (passenger cars) has one rubric per make:
 *   `https://auto.bazos.cz/<makeSlug>/` (e.g. `/skoda/`, `/volkswagen/`),
 *   confirmed 200 with real listings. These rubrics do NOT include the
 *   sibling categories `nahradnidily` (parts), `pneumatiky` (tires),
 *   `prislusenstvi` (accessories) or `tuning` — so searching a make rubric
 *   is the actual server-side "passenger cars only" filter.
 * - A rubric can be combined with a keyword: `/<makeSlug>/?hledat=<model>`
 *   (confirmed 200, e.g. `/skoda/?hledat=octavia`).
 * - Root keyword search `/?hledat=<kw>&rubriky=auto` 301-redirects to the
 *   pretty `/inzeraty/<kw>/` URL; `fetch` follows redirects automatically
 *   so the query-string form is used directly for simplicity.
 * - Pagination is a flat `crp=<offset>` query param (offset in listings,
 *   page size 20) that works uniformly on rubric pages, keyword pages and
 *   the root category page alike (confirmed on all three).
 * - No make/model given (root `/?rubriky=auto`) returns the *entire* "Auto"
 *   category, which mixes in parts/tires/accessories/tuning ads — those
 *   are filtered out with the `looksLikeJunkListing` heuristic from
 *   `_util-b.ts` (very cheap + no year/mileage extracted at all).
 * - year/mileage/fuel/transmission/power are not separate fields on the
 *   list page — they're free text inside the title + description blob
 *   (e.g. "2024 | 102 900 km | MATRIX LED ...") and are extracted with
 *   regexes in `_util-b.ts`.
 * - images: previously always `[]`. Confirmed live: `.inzeratynadpis`
 *   (inside `.inzeraty.inzeratyflex`, see the note above about the
 *   missing closing `</div>`) has a real `<img class="obrazek"
 *   src="https://www.bazos.cz/img/...">` — already an absolute URL, no
 *   lazy-load placeholder. A listing with no photo simply has no such
 *   `<img>`, so `imageUrls` stays `[]` for those.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { normalizeMake } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import {
  extractMileageKm,
  extractPowerKw,
  extractYear,
  guessFuel,
  guessTransmission,
  looksLikeJunkListing,
  parseCzNumber,
} from "./_util-b.js";

const BASE_URL = "https://auto.bazos.cz";
const PAGE_SIZE = 20;

/** Canonical make (from `normalizeMake`) -> Bazoš "Osobní auta" rubric slug. */
const MAKE_RUBRIC_SLUGS: Record<string, string> = {
  "alfa-romeo": "alfa",
  audi: "audi",
  bmw: "bmw",
  citroen: "citroen",
  dacia: "dacia",
  fiat: "fiat",
  ford: "ford",
  honda: "honda",
  hyundai: "hyundai",
  chevrolet: "chevrolet",
  kia: "kia",
  mazda: "mazda",
  "mercedes-benz": "mercedes",
  mitsubishi: "mitsubishi",
  nissan: "nissan",
  opel: "opel",
  peugeot: "peugeot",
  renault: "renault",
  seat: "seat",
  suzuki: "suzuki",
  skoda: "skoda",
  toyota: "toyota",
  volkswagen: "volkswagen",
  volvo: "volvo",
};

export function buildBazosUrl(query: SearchQuery, offset: number): string {
  const normalizedMake = normalizeMake(query.make);
  const rubricSlug = normalizedMake ? MAKE_RUBRIC_SLUGS[normalizedMake] : undefined;
  const params = new URLSearchParams();
  let path: string;

  if (rubricSlug) {
    // Precise passenger-car-only search: rubric per make, optional model keyword.
    path = `/${rubricSlug}/`;
    if (query.model) params.set("hledat", query.model);
  } else {
    // No known make rubric: fall back to a keyword search (redirects to the
    // pretty URL) or, with no keywords at all, the whole "Auto" category
    // (filtered for junk below).
    path = "/";
    params.set("rubriky", "auto");
    const keywords = [query.make, query.model].filter(Boolean).join(" ");
    if (keywords) params.set("hledat", keywords);
  }

  if (query.priceFrom) params.set("cenaod", String(query.priceFrom));
  if (query.priceTo) params.set("cenado", String(query.priceTo));
  if (offset > 0) params.set("crp", String(offset));

  const qs = params.toString();
  return qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
}

export function parseBazosHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $(".inzeraty.inzeratyflex").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("h2.nadpis a, .nadpis a").first();
    const href = linkEl.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/\/(\d+)\/[^/]*$/) ?? href.match(/\/(\d+)\/?$/);
    const sourceId = idMatch?.[1] ?? href;

    const title = linkEl.text().trim();
    const description = $el.find(".popis").first().text().trim();
    const fullText = `${title} ${description}`;

    const price = parseCzNumber($el.find(".inzeratycena").first().text());
    // Location is "<city><br><postcode>" — take just the city (first text node).
    const locText = $el.find(".inzeratylok").first().contents().first().text().trim();
    const location = locText || null;

    const year = extractYear(fullText);
    const mileageKm = extractMileageKm(fullText);
    if (looksLikeJunkListing(price, year, mileageKm)) return;

    const imgSrc = $el.find("img.obrazek").first().attr("src");
    const imageUrls = imgSrc ? [imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`] : [];

    out.push({
      sourceId,
      url,
      title,
      make: null,
      model: null,
      variant: description || null,
      year,
      mileageKm,
      price,
      currency: "CZK",
      fuel: guessFuel(fullText),
      transmission: guessTransmission(fullText),
      powerKw: extractPowerKw(fullText),
      body: null,
      color: null,
      location,
      country: "CZ",
      sellerType: "private",
      vin: null,
      imageUrls,
    });
  });

  return out;
}

export const bazosAdapter: SourceAdapter = {
  id: "bazos",
  verified: true,
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
      // A page can have a full 20 raw ads but end up with fewer (or zero)
      // after the junk filter, so use a marker count rather than
      // `items.length` to decide whether to keep paginating.
      const rawCount = (html.match(/class="inzeraty inzeratyflex"/g) ?? []).length;
      if (rawCount < PAGE_SIZE) break;
    }
    console.log(`[bazos] fetched ${out.length} listings`);
    return out;
  },
};
