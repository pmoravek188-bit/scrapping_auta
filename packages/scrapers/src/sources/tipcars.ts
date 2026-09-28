/**
 * TipCars.com adapter — VERIFIED live 2026-09-28.
 *
 * The old guess (`/inzerce/osobni-vozy/?strana=1`) 404s. The real used-car
 * listing root is `https://www.tipcars.com/ojete` (all used cars) and
 * supports server-side filtering by make/model via URL PATH segments, not
 * query params:
 *   - `/ojete/{makeSlug}`            e.g. `/ojete/skoda`
 *   - `/ojete/{makeSlug}-{modelSlug}` e.g. `/ojete/skoda-octavia`
 * (confirmed live: `numberOfItems` in the embedded JSON-LD differs between
 * `/ojete`, `/ojete/skoda`, and `/ojete/skoda-octavia`). Query params for
 * price/year/mileage (`cena-od`, `rok-od`, `najeto-do`, ...) were tried and
 * do NOT change `numberOfItems` — they're not wired server-side (likely
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
 * Listing cards render id/url/name/price/image via a `<script type=
 * "application/ld+json">` `ItemList` block (used for those fields — more
 * robust than CSS selectors). Make/model/body/fuel are derived from the
 * listing URL path itself, which TipCars structures as
 * `/{make-model-slug}/{body}/{fuel}/{title-slug}-{id}.html` (confirmed
 * against dozens of live listing URLs, e.g.
 * `/skoda-octavia/kombi/nafta/skoda-octavia-2-0-tdi-...-54003315.html`,
 * `/land-rover-discovery/suv/nafta/...`,
 * `/mercedes-benz-tridy-c/sedan/benzin/...`).
 *
 * year/mileage/power are NOT missing from the list page as first assumed —
 * they just aren't in the ld+json. Each listing card carries a
 * `data-measure-data-value` attribute (a Stimulus/analytics hook) whose
 * value is a JSON array `["advertise", {id, made_year, engine_power,
 * odometer, price, ...}, "<hash>"]`; `id` matches the ld+json item's
 * trailing URL id, `made_year` is the registration year, `engine_power` is
 * kW, `odometer` is km (confirmed against 20+ live cards, including
 * cross-checking `price` in that blob against the ld+json price — always
 * equal). That map is built once per page and joined onto the ld+json items
 * by sourceId. sellerType still isn't derivable from the listing page, so
 * it's left "unknown" (a valid SELLER_TYPES value) rather than guessed.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { MAKE_ALIASES, slugifyMakeModel } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

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

const LISTING_URL_RE = /^https:\/\/www\.tipcars\.com\/([a-z0-9-]+)\/([a-z-]+)\/([a-z-]+)\/[a-z0-9-]+-(\d+)\.html$/;

interface TipCarsItemListItem {
  item?: {
    "@id"?: string;
    url?: string;
    name?: string;
    image?: string;
    offers?: { price?: number };
  };
}

interface TipCarsMeasureData {
  id?: string;
  made_year?: string | number;
  engine_power?: number;
  odometer?: number;
  price?: number;
}

/** Parses every `data-measure-data-value="[...]"` card attribute on the page
 * into a map of sourceId -> {year, mileageKm, powerKw}, so it can be joined
 * onto the ld+json items (which don't carry those fields). */
function parseMeasureDataById(
  $: cheerio.CheerioAPI
): Map<string, { year: number | null; mileageKm: number | null; powerKw: number | null }> {
  const map = new Map<string, { year: number | null; mileageKm: number | null; powerKw: number | null }>();
  $("[data-measure-data-value]").each((_, el) => {
    const raw = $(el).attr("data-measure-data-value");
    if (!raw) return;
    let arr: unknown;
    try {
      arr = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(arr) || arr[0] !== "advertise") return;
    const data = arr[1] as TipCarsMeasureData | undefined;
    if (!data?.id) return;
    const year = data.made_year != null ? Number(data.made_year) : null;
    map.set(data.id, {
      year: Number.isFinite(year) ? year : null,
      mileageKm: data.odometer ?? null,
      powerKw: data.engine_power ?? null,
    });
  });
  return map;
}

export function parseTipCarsHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const measureById = parseMeasureDataById($);
  const out: RawListing[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    let json: unknown;
    try {
      json = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    const doc = json as { "@type"?: string; itemListElement?: unknown };
    if (doc?.["@type"] !== "ItemList" || !doc.itemListElement) return;

    const raw = doc.itemListElement;
    const items: TipCarsItemListItem[] = Array.isArray(raw)
      ? (raw as TipCarsItemListItem[])
      : Object.values(raw as Record<string, TipCarsItemListItem>);

    for (const entry of items) {
      const it = entry?.item;
      if (!it) continue;
      const url = it.url ?? it["@id"];
      if (!url) continue;
      const m = LISTING_URL_RE.exec(url);
      if (!m) continue;
      const [, makeModelSlug, body, fuel, idStr] = m;
      if (!makeModelSlug || !body || !fuel || !idStr) continue;
      const { make, model } = splitMakeModelSlug(makeModelSlug);
      const measured = measureById.get(idStr);

      out.push({
        sourceId: idStr,
        url,
        title: it.name ?? "",
        make,
        model,
        variant: null,
        year: measured?.year ?? null,
        mileageKm: measured?.mileageKm ?? null,
        price: it.offers?.price ?? null,
        currency: "CZK",
        fuel,
        transmission: null,
        powerKw: measured?.powerKw ?? null,
        body,
        color: null,
        location: null,
        country: "CZ",
        sellerType: "unknown",
        vin: null,
        imageUrls: it.image ? [it.image] : [],
      });
    }
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
