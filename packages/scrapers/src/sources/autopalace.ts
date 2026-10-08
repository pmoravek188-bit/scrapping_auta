/**
 * Auto Palace (autopalace.cz) adapter — VERIFIED live 2026-10-08.
 *
 * Auto Palace Group (AutoBinck-owned) bills itself as the largest
 * automotive dealer group in the Czech Republic (Ford/Hyundai/Mazda/MG/
 * Opel/Peugeot/Škoda/Volvo/Cupra new-car franchises, plus multi-brand
 * used-car trade-ins across many more makes). This is its OWN used stock,
 * not an aggregator — confirmed live the unfiltered
 * `/skladove-vozy/typy_ojete/` search reports 552 cars total, paginating to
 * page 46 at 12 cards/page.
 *
 * URL structure (server-rendered HTML, Nette Framework; same dealer-CMS
 * vendor as autojarov.ts — same `robots.txt` shape, same
 * "searchEngine-listVehicles-..." element-id naming convention — but a
 * visibly different/newer card template, so no parsing code is shared
 * between the two files):
 *   - `https://www.autopalace.cz/skladove-vozy/typy_ojete/` — all used cars
 *     (NOT the same as `/ojete-vozy/` — that's a marketing landing page
 *     with only a handful of teaser cards, confirmed live).
 *   - `.../typy_ojete/znacky_<slug>/` — one brand, confirmed live
 *     server-side (e.g. `znacky_bmw` returns only BMWs).
 *   - Pagination: `.../<n>/` (1-based; 2nd page is `/2/`), confirmed live.
 *   - Page size: 12 cards/page, confirmed live.
 *
 * MODEL FILTER: as with autojarov.cz, `robots.txt` disallows `*modely_*`
 * path segments, so model-level filtering is left to the runner's
 * client-side matcher.
 *
 * CARD MARKUP: each result is `article.vehicle-smallCard[data-vehicle-id]`
 * — confirmed live the id attribute is the clean numeric listing id (more
 * reliable than parsing it back out of the href, whose trailing token is
 * sometimes a `czNNNNNN`-prefixed slug rather than a bare number). The
 * `h3.title > a` link carries `data-vehicle-manufacturer` (make, as plain
 * text, e.g. "Škoda") and `data-vehicle-bodywork` (body type, e.g. "kombi")
 * as attributes directly — no text scraping needed for either — plus the
 * model name as its own trailing text node after a `<span>` holding the
 * make. `.engine` holds the trim/engine text. Each `ul.info li` has an
 * `<i class="ssg ssg-<kind>">` icon class that unambiguously identifies the
 * field (`ssg-tachometer`=mileage, `ssg-calendar`=in-service date as
 * "YYYY/M", `ssg-engine-flash`=power, `ssg-drop-flash`=fuel,
 * `ssg-transmission`=transmission) — classified by icon class, not
 * position, confirmed live across several cards. Price is `.prices .price`
 * (its nested "Není možný odpočet DPH"/VAT-deductibility `<small>` is
 * stripped before parsing). Location is `a.branch`'s `title` attribute.
 * Images: `.imagesContainer img` — confirmed live a car with no real photos
 * yet gets a `no-photo-vehicle-cz.jpg` placeholder instead of omitting the
 * tag, filtered out here.
 *
 * ANTI-BOT: none observed — plain nginx/Nette server-rendered HTML, no
 * Cloudflare/JS challenge, confirmed live across a handful of throttled
 * requests (2026-10-08). `looksLikeAutoPalaceListingPage` below still
 * throws on anything that doesn't look like the real template, the same
 * defensive pattern as autobazar.ts/aaaauto.ts, in case that changes under
 * sustained GitHub-Actions traffic.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { inferMakeModel, normalizeMake } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { extractPowerKw, guessFuel, guessTransmission, parseCzNumber } from "./_util-b.js";

const BASE_URL = "https://www.autopalace.cz";
const LIST_PATH = "/skladove-vozy/typy_ojete";
const PAGE_SIZE = 12;

export function buildAutoPalaceUrl(brandSlug: string | null, page: number): string {
  const segments = [LIST_PATH];
  if (brandSlug) segments.push(`znacky_${brandSlug}`);
  if (page > 0) segments.push(String(page + 1));
  return `${BASE_URL}${segments.join("/")}/`;
}

/** True if `html` looks like a real autopalace.cz search-results page —
 * see autojarov.ts's `looksLikeAutoJarovListingPage` (same dealer-CMS
 * vendor, same container marker). */
export function looksLikeAutoPalaceListingPage(html: string): boolean {
  return html.includes("vehicles-list");
}

const CALENDAR_RE = /(\d{4})\s*\/\s*(\d{1,2})/;

export function parseAutoPalaceHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $("article.vehicle-smallCard").each((_, el) => {
    const $el = $(el);
    const sourceId = $el.attr("data-vehicle-id");
    const linkEl = $el.find("h3.title a").first();
    const href = linkEl.attr("href");
    if (!sourceId || !href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    const titleAttr = linkEl.attr("data-vehicle-title") ?? linkEl.attr("title") ?? "";
    const rawMakeAttr = linkEl.attr("data-vehicle-manufacturer") ?? "";
    const make = normalizeMake(rawMakeAttr);
    const modelText = linkEl.clone().children("span").remove().end().text().replace(/\s+/g, " ").trim();
    const variant = $el.find(".engine").first().text().replace(/\s+/g, " ").trim() || null;
    const body = linkEl.attr("data-vehicle-bodywork") || null;

    let transmission: string | null = null;
    let fuel: string | null = null;
    let powerKw: number | null = null;
    let mileageKm: number | null = null;
    let year: number | null = null;
    $el.find("ul.info li").each((__, liEl) => {
      const $li = $(liEl);
      const iconClass = $li.find("i").first().attr("class") ?? "";
      const text = $li.text().replace(/\s+/g, " ").trim();
      if (!text) return;
      if (iconClass.includes("tachometer")) mileageKm = parseCzNumber(text);
      else if (iconClass.includes("calendar")) {
        const m = CALENDAR_RE.exec(text);
        if (m) year = Number(m[1]);
      } else if (iconClass.includes("engine-flash")) powerKw = extractPowerKw(text) ?? parseCzNumber(text);
      else if (iconClass.includes("drop-flash")) fuel = guessFuel(text);
      else if (iconClass.includes("transmission")) transmission = guessTransmission(text);
    });

    const priceText = $el.find(".prices .price").first().clone().children("small").remove().end().text();
    const price = parseCzNumber(priceText);

    const location = $el.find("a.branch").first().attr("title")?.trim() || null;

    const imgSrc = $el.find(".imagesContainer img").first().attr("src");
    const imageUrls =
      imgSrc && !imgSrc.includes("no-photo-vehicle")
        ? [imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`]
        : [];

    const { model } = inferMakeModel(modelText, make ?? undefined);

    out.push({
      sourceId,
      url,
      title: titleAttr || [rawMakeAttr, modelText].filter(Boolean).join(" "),
      make,
      model,
      variant,
      year,
      mileageKm,
      price,
      currency: "CZK",
      fuel,
      transmission,
      powerKw,
      body,
      color: null,
      location,
      country: "CZ",
      sellerType: "dealer",
      vin: null,
      imageUrls,
    });
  });

  return out;
}

export const autopalaceAdapter: SourceAdapter = {
  id: "autopalace",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const brandSlug = normalizeMake(query.make);
    const out: RawListing[] = [];
    let hitCap = false;
    for (let page = 0; page < maxPages; page++) {
      const url = buildAutoPalaceUrl(brandSlug, page);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        const message = (err as Error).message;
        console.warn(`[autopalace] request failed on page ${page}:`, message);
        if (page === 0) throw new Error(`[autopalace] request failed on page 0: ${message}`);
        break;
      }
      if (!looksLikeAutoPalaceListingPage(html)) {
        throw new Error(
          `[autopalace] response doesn't look like a real autopalace.cz page (possible block) at ${url}`
        );
      }
      const items = parseAutoPalaceHtml(html);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
      if (page === maxPages - 1) hitCap = true;
    }
    if (hitCap) ctx.onPageCapHit?.();
    console.log(`[autopalace] fetched ${out.length} listings`);
    return out;
  },
};
