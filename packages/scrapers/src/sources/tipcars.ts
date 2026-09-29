/**
 * TipCars.com adapter.
 *
 * The real used-car listing root is `https://www.tipcars.com/ojete` (all
 * used cars) and supports server-side filtering by make/model via URL PATH
 * segments, not query params:
 *   - `/ojete/{makeSlug}`            e.g. `/ojete/skoda`
 *   - `/ojete/{makeSlug}-{modelSlug}` e.g. `/ojete/skoda-octavia`
 * (confirmed live: the "Zobrazeno N inzerátů" count differs between
 * `/ojete`, `/ojete/skoda`, and `/ojete/skoda-octavia`). Query params for
 * price/year/mileage (`cena-od`, `rok-od`, `najeto-do`, ...) were tried and
 * do NOT change that count — they're not wired server-side (likely
 * client-side-only filters in the SPA), so those are left to the runner's
 * matcher.
 *
 * Pagination is `?str={page}-{pageSize}` (1-indexed page, pageSize=20), but
 * the actual item count per page is NOT reliably 20 — the unfiltered
 * `/ojete` root, for example, renders exactly 18 items per page (confirmed
 * on both page 1 and page 2, each with a fully distinct set of ids), while
 * make-filtered pages like `/ojete/skoda-octavia` render 20. So the loop
 * does NOT stop on `items.length < pageSize` (that stopped real multi-page
 * results after a single page); it stops when a page returns zero items, or
 * when a page's items are all ids already seen on an earlier page (dedup by
 * sourceId), whichever comes first.
 *
 * RE-VERIFIED live 2026-09-28: the site no longer embeds a `ItemList`
 * `application/ld+json` block on search-result pages (confirmed absent on
 * `/ojete`, `/ojete/skoda`, `/ojete/skoda-octavia` and a make/model-filtered
 * page like `/ojete/ford-tourneo-custom` — only `Organization`/`WebSite`
 * ld+json remain). Listing cards are now parsed directly from the rendered
 * markup instead:
 * - Each card is a `[data-listing-item-id-value]` element (the numeric id);
 *   confirmed to appear exactly once per distinct listing on a page (some
 *   duplicate desktop/mobile sub-blocks live *inside* one such element, but
 *   the id attribute itself is unique per card).
 * - Its first `a[href$=".html"]` is the detail link, structured as
 *   `/{make-model-slug}/{body}/{fuel}/{title-slug}-{id}.html` (confirmed
 *   against dozens of live listing URLs, e.g.
 *   `/skoda-octavia/kombi/nafta/skoda-octavia-2-0-tdi-...-54003315.html`,
 *   `/land-rover-discovery/suv/nafta/...`) — used for make/model/body/fuel.
 * - Title: `.advertisement-name__title h3`. Variant/trim text:
 *   `.advertisement-name__title p`. Price: `.advertisement-name__price`.
 * - year/mileage/power/fuel/transmission: each card has a set of
 *   `.detail-box-S[title="..."]` boxes with a fixed set of Czech `title`
 *   labels — confirmed live: "V provozu od/Rok výroby" (year), "Tachometr"
 *   (mileage km), "Výkon" (power kW), "Palivo" (fuel text), "Převodovka"
 *   (transmission text, e.g. "manuál"/"automat"). Not every card has these
 *   (smaller/boosted "advertisement--small-img" cards omit them) — for those,
 *   year/mileage/power fall back to the card's `data-measure-data-value`
 *   attribute (a Stimulus/analytics hook, JSON array `["advertise", {id,
 *   made_year, engine_power, odometer, price, ...}]`, confirmed present on
 *   every card) when the detail-box value is missing.
 * - Make/model: derived from the URL's make-model slug via
 *   `splitMakeModelSlug` (aware of known multi-word makes so e.g.
 *   "land-rover-discovery" isn't split as make="land" model="rover-discovery").
 *   BUG FIX: that first URL path segment is sometimes a category, not a
 *   make (e.g. "uzitkove" = "commercial vehicles", seen on some van/pickup
 *   listings reached via a body-type category rather than a brand page) —
 *   confirmed by it never being a recognized make slug. When the parsed
 *   "make" isn't one of the app's known make slugs
 *   (`@scrapping-auta/core`'s `isKnownMakeSlug`), it's discarded and
 *   make/model are instead inferred from the listing title text with
 *   `inferMakeModel`, which is far more reliable than the mis-parsed
 *   category segment.
 * - sellerType still isn't derivable from the listing page, so it's left
 *   "unknown" (a valid SELLER_TYPES value) rather than guessed.
 * - images: the old adapter never extracted any (`imageUrls: []` always).
 *   Confirmed live: each card has exactly one real `<img>` whose `src`
 *   already points at TipCars' imgproxy CDN, `g.tipcars.com/.../rs:fit:800:600:...`
 *   (an already-resized, working 800x600 JPEG URL, not a lazy-load
 *   placeholder — no `data-src`/`srcset` needed). It's the only `<img>`
 *   inside the card whose `src` host is `g.tipcars.com` (the other `<img>`s
 *   in a card are small UI icons served from `www.tipcars.com/build/icons`).
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { MAKE_ALIASES, inferMakeModel, isKnownMakeSlug, normalizeMake, slugifyMakeModel } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { guessFuel, guessTransmission, parseCzNumber } from "./_util-b.js";

const BASE_URL = "https://www.tipcars.com";
const PAGE_SIZE = 20;

/** Known multi-word make slugs (from the shared alias table) so we don't split
 * e.g. "mercedes-benz-tridy-c" into make="mercedes" model="benz-tridy-c". */
const MULTI_WORD_MAKE_SLUGS = Array.from(
  new Set(Object.keys(MAKE_ALIASES).map((k) => slugifyMakeModel(k)).filter((k) => k.includes("-")))
).sort((a, b) => b.length - a.length);

export function buildTipCarsUrl(query: SearchQuery, page: number): string {
  let path = "/ojete";
  if (query.make) {
    const makeSlug = slugifyMakeModel(query.make);
    const modelSlug = query.model ? slugifyMakeModel(query.model) : null;
    path += `/${makeSlug}${modelSlug ? `-${modelSlug}` : ""}`;
  }
  const params = new URLSearchParams();
  params.set("str", `${page + 1}-${PAGE_SIZE}`);
  return `${BASE_URL}${path}?${params.toString()}`;
}

/** Splits a TipCars make-model URL slug (e.g. "land-rover-discovery") into
 * make/model parts, using the known multi-word makes to avoid bad splits. */
function splitMakeModelSlug(slug: string): { make: string; model: string | null } {
  for (const prefix of MULTI_WORD_MAKE_SLUGS) {
    if (slug === prefix) return { make: prefix, model: null };
    if (slug.startsWith(`${prefix}-`)) return { make: prefix, model: slug.slice(prefix.length + 1) };
  }
  const idx = slug.indexOf("-");
  if (idx === -1) return { make: slug, model: null };
  return { make: slug.slice(0, idx), model: slug.slice(idx + 1) };
}

const LISTING_HREF_RE = /^\/([a-z0-9-]+)\/([a-z-]+)\/([a-z-]+)\/[a-z0-9-]+\.html$/;

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

interface TipCarsMeasureData {
  id?: string;
  made_year?: string | number;
  engine_power?: number;
  odometer?: number;
  price?: number;
}

function parseMeasureData(
  raw: string | undefined
): { year: number | null; mileageKm: number | null; powerKw: number | null } | null {
  if (!raw) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr[0] !== "advertise") return null;
  const data = arr[1] as TipCarsMeasureData | undefined;
  if (!data) return null;
  const year = data.made_year != null ? Number(data.made_year) : null;
  return {
    year: Number.isFinite(year) ? year : null,
    mileageKm: typeof data.odometer === "number" ? data.odometer : null,
    powerKw: typeof data.engine_power === "number" ? data.engine_power : null,
  };
}

export function parseTipCarsHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];
  const seenIds = new Set<string>();

  $("[data-listing-item-id-value]").each((_, el) => {
    const $el = $(el);
    const id = $el.attr("data-listing-item-id-value");
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);

    const href = $el.find('a[href$=".html"]').first().attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const hrefMatch = LISTING_HREF_RE.exec(href);
    const makeModelSlug = hrefMatch?.[1] ?? null;
    const body = hrefMatch?.[2] ?? null;
    const fuelSlug = hrefMatch?.[3] ?? null;

    const title = $el.find(".advertisement-name__title h3").first().text().trim().replace(/\s+/g, " ");
    if (!title) return;
    const variant = $el.find(".advertisement-name__title p").first().text().trim() || null;
    // The price block can carry a second, smaller "<price> bez DPH" (VAT-excl.)
    // line for dealer listings — read only the main <h3> price, not the
    // whole section's text (which would concatenate both numbers into one).
    const price = parseCzNumber($el.find(".advertisement-name__price h3").first().text());

    let fuelText = "";
    let transmissionText = "";
    let year: number | null = null;
    let mileageKm: number | null = null;
    let powerKw: number | null = null;
    $el.find(".detail-box-S").each((__, boxEl) => {
      const $box = $(boxEl);
      const label = $box.attr("title") ?? "";
      const value = $box.find(".detail-box-S__text").first().text().trim();
      if (label.startsWith("Palivo")) fuelText = value;
      else if (label.startsWith("Převodovka")) transmissionText = value;
      else if (label.startsWith("V provozu") || label.startsWith("Rok výroby")) {
        year = /^\d{4}$/.test(value) ? Number(value) : null;
      } else if (label.startsWith("Tachometr")) mileageKm = parseCzNumber(value);
      else if (label.startsWith("Výkon")) powerKw = parseCzNumber(value);
    });

    const imageUrls: string[] = [];
    $el.find("img").each((__, imgEl) => {
      const src = $(imgEl).attr("src");
      if (src && /(^|\.)g\.tipcars\.com$/.test(safeHost(src))) imageUrls.push(src);
    });

    const measured = parseMeasureData($el.attr("data-measure-data-value"));
    if (year == null) year = measured?.year ?? null;
    if (mileageKm == null) mileageKm = measured?.mileageKm ?? null;
    if (powerKw == null) powerKw = measured?.powerKw ?? null;

    let make: string | null = null;
    let model: string | null = null;
    if (makeModelSlug) {
      const split = splitMakeModelSlug(makeModelSlug);
      if (isKnownMakeSlug(normalizeMake(split.make))) {
        make = split.make;
        model = split.model;
      }
    }
    if (!make) {
      // The URL's leading path segment wasn't a recognized make (e.g. a
      // "uzitkove" commercial-vehicle category slug) — fall back to
      // inferring make/model from the title text instead.
      const inferred = inferMakeModel(title);
      make = inferred.make;
      model = inferred.model;
    }

    out.push({
      sourceId: id,
      url,
      title,
      make,
      model,
      variant,
      year,
      mileageKm,
      price,
      currency: "CZK",
      fuel: guessFuel(fuelText) || (fuelSlug ? guessFuel(fuelSlug) : null),
      transmission: guessTransmission(transmissionText),
      powerKw,
      body,
      color: null,
      location: null,
      country: "CZ",
      sellerType: "unknown",
      vin: null,
      imageUrls,
    });
  });

  return out;
}

export const tipcarsAdapter: SourceAdapter = {
  id: "tipcars",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    const seenIds = new Set<string>();
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
      if (items.length === 0) break;

      let newCount = 0;
      for (const item of items) {
        if (seenIds.has(item.sourceId)) continue;
        seenIds.add(item.sourceId);
        out.push(item);
        newCount++;
      }
      // A page that repeats only ids we've already seen means we've looped
      // back / reached the end, regardless of how many items it rendered.
      if (newCount === 0) break;
    }
    console.log(`[tipcars] fetched ${out.length} listings`);
    return out;
  },
};
