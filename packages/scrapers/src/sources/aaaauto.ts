/**
 * AAA Auto (aaaauto.cz) adapter — VERIFIED live 2026-09-28.
 *
 * The old guess (`/vozy?page=1`) 404s. The real used-car listing root is
 * `https://www.aaaauto.cz/ojete-vozy` with make/model path filters:
 *   - `/ojete-vozy/{makeSlug}`             e.g. `/ojete-vozy/skoda`
 *   - `/ojete-vozy/{makeSlug}/{modelSlug}` e.g. `/ojete-vozy/skoda/octavia`
 * (confirmed live by diffing the `totalItems` count embedded in the page).
 *
 * Listing pages embed the current page's cars as `Product`/`Car` items
 * inside a single `<script type="application/ld+json">` block containing an
 * `@graph` array; the `ItemList` entry in that graph has the per-item data
 * we need directly (name, brand, model, dateVehicleFirstRegistered,
 * mileageFromOdometer, fuelType, bodyType, vehicleTransmission, price,
 * image, url) — no separate API call or CSS-selector guessing required.
 * Every listing is sold by AAA AUTO itself (`seller.@id` points at the
 * single dealer org in the graph), so `sellerType` is always "dealer".
 *
 * `sku`/`productID`/`vehicleIdentificationNumber` in the JSON-LD are NOT a
 * real VIN — they're an internal stock number distinct from the id in the
 * URL (confirmed: they differ from the URL's numeric id on the same item),
 * so `vin` is left null rather than reporting a fake one; `sourceId` is
 * taken from the URL's trailing id segment instead (also used to rebuild
 * the detail URL: `https://www.aaaauto.cz/detail/{make}/{model}/{id}`).
 *
 * Pagination confirmed via `?page=N` (35 items/page, `totalItems` in an
 * inline JSON blob on the page tracks the true filtered total).
 * Server-side filters confirmed live via that `totalItems` count:
 * `priceFrom`, `priceTo`, `yearFrom`, `yearTo`, `mileageTo`. A body-type
 * filter (`bodyTypeId-array=SUV`/`MPV`) also demonstrably filters, but only
 * those two exact enum values could be confirmed — other body/fuel/
 * transmission strings tried (`Kombi`, `Sedan`, `Hatchback`, `Combi`,
 * `Saloon`, numeric `fuelTypeId`, `transmissionId-array`, ...) were silently
 * ignored (same result count as unfiltered), so they're left to the
 * runner's client-side matcher instead of guessing wrong values.
 *
 * Mercedes-Benz lettered classes: confirmed live that aaaauto.cz's own model
 * path segment for every one of them is just the bare letter (e.g.
 * `/ojete-vozy/mercedes-benz/v`, `totalItems` 14 vs the unfiltered make's
 * 340) — matching its own structured listing data, where the ld+json
 * `model` field for a V-Class car is literally `"V"`, not `"V-Class"`.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import {
  audiQ8EtronFallbackSlug,
  bmwSeriesNumber,
  mercedesClassLetter,
  normalizeMake,
  slugifyMakeModel,
  vwIdModelUrlSlug,
} from "@scrapping-auta/core";
import { fetchText, fetchTextWithUrl, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { extractPowerKw } from "./_util-b.js";

const BASE_URL = "https://www.aaaauto.cz";
const PAGE_SIZE = 35;

/** Only these two body-type filter values were confirmed to actually change
 * the live result count; everything else is left to the client matcher. */
const BODY_FILTER_MAP: Partial<Record<string, string>> = {
  suv: "SUV",
  mpv: "MPV",
};

export function buildAaaAutoUrl(query: SearchQuery, page: number): string {
  let path = "/ojete-vozy";
  if (query.make) {
    path += `/${slugifyMakeModel(query.make)}`;
    if (query.model) {
      const isBmw = normalizeMake(query.make) === "bmw";
      const letter = normalizeMake(query.make) === "mercedes-benz" ? mercedesClassLetter(query.model) : null;
      // aaaauto.cz's own model path segment for a BMW numbered series is the
      // bare digit (e.g. `/ojete-vozy/bmw/3`, confirmed live) — matching its
      // own structured listing data, where the ld+json `model` field for a
      // 3-series car is literally "3".
      const bmwDigit = isBmw ? bmwSeriesNumber(query.model) : null;
      // aaaauto.cz's own model path segment for a VW "ID." model is a
      // hyphen-less "id4" (confirmed live — see `vwIdModelUrlSlug`'s doc
      // comment); the hyphenated canonical form 302-redirects to the
      // unfiltered listing instead of filtering.
      const vwIdSlug = normalizeMake(query.make) === "volkswagen" ? vwIdModelUrlSlug(query.model) : null;
      // aaaauto.cz hasn't split "Q8 e-tron" out of "e-tron" in its own
      // catalog (see `audiQ8EtronFallbackSlug`'s doc comment) — our
      // canonical "q8-e-tron" 302-redirects there too.
      const audiEtronSlug = normalizeMake(query.make) === "audi" ? audiQ8EtronFallbackSlug(query.model) : null;
      path += `/${letter ?? bmwDigit ?? vwIdSlug ?? audiEtronSlug ?? slugifyMakeModel(query.model)}`;
    }
  }
  const params = new URLSearchParams();
  params.set("page", String(page + 1));
  if (query.priceFrom) params.set("priceFrom", String(query.priceFrom));
  if (query.priceTo) params.set("priceTo", String(query.priceTo));
  if (query.yearFrom) params.set("yearFrom", String(query.yearFrom));
  if (query.yearTo) params.set("yearTo", String(query.yearTo));
  if (query.mileageMax) params.set("mileageTo", String(query.mileageMax));
  const bodyFilter = query.body[0];
  if (query.body.length === 1 && bodyFilter) {
    const val = BODY_FILTER_MAP[bodyFilter];
    if (val) params.set("bodyTypeId-array", val);
  }
  return `${BASE_URL}${path}?${params.toString()}`;
}

interface AaaCarLd {
  name?: string;
  brand?: { name?: string };
  model?: string;
  dateVehicleFirstRegistered?: string;
  mileageFromOdometer?: { value?: number };
  fuelType?: string;
  bodyType?: string;
  vehicleTransmission?: string;
  color?: string;
  image?: string[];
  offers?: { price?: number; priceCurrency?: string };
  url?: string;
}

function idFromUrl(url: string): string | null {
  const m = /\/(\d+)\/?$/.exec(url);
  return m?.[1] ?? null;
}

/**
 * True if `html` looks like a real aaaauto.cz page (confirmed live: every
 * real page — whether it has matching cars or genuinely zero, see the
 * `priceFrom=99999999` live check — embeds a `WebPage`/`AutoDealer` entry in
 * its ld+json `@graph`; a genuinely empty result just omits the `ItemList`
 * entry instead, it still has these). False means the response is something
 * else entirely (most likely a bot-mitigation/geo-block/consent page served
 * instead of the real one — confirmed live: aaaauto has returned `found: 0`
 * on EVERY GitHub Actions run since this source was added, each with a plain
 * HTTP 200 and no redirect, while the exact same request from a residential
 * IP always returns the real page) — `search()` below treats that as a real
 * error instead of silently reporting zero results. */
export function looksLikeAaaAutoListingPage(html: string): boolean {
  const scripts = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  for (const scriptMatch of scripts) {
    const rawJson = scriptMatch[1];
    if (!rawJson) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(rawJson);
    } catch {
      continue;
    }
    const graph = (doc as { "@graph"?: unknown[] })?.["@graph"] ?? [];
    const hasPageMarker = graph.some((g) => {
      if (typeof g !== "object" || g === null) return false;
      const type = (g as { "@type"?: string })["@type"];
      return type === "WebPage" || type === "AutoDealer";
    });
    if (hasPageMarker) return true;
  }
  return false;
}

export function parseAaaAutoHtml(html: string): RawListing[] {
  const scripts = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );
  const out: RawListing[] = [];
  for (const scriptMatch of scripts) {
    const rawJson = scriptMatch[1];
    if (!rawJson) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(rawJson);
    } catch {
      continue;
    }
    const graph = (doc as { "@graph"?: unknown[] })?.["@graph"] ?? [];
    const itemList = graph.find(
      (g): g is { itemListElement?: unknown[] } =>
        typeof g === "object" && g !== null && (g as { "@type"?: string })["@type"] === "ItemList"
    );
    if (!itemList?.itemListElement) continue;

    for (const entry of itemList.itemListElement) {
      const item = (entry as { item?: AaaCarLd })?.item;
      const url = item?.url;
      if (!item || !url) continue;
      const id = idFromUrl(url);
      if (!id) continue;

      out.push({
        sourceId: id,
        url,
        title: item.name ?? "",
        make: item.brand?.name ?? null,
        model: item.model ?? null,
        variant: null,
        year: item.dateVehicleFirstRegistered ? Number(item.dateVehicleFirstRegistered) : null,
        mileageKm: item.mileageFromOdometer?.value ?? null,
        price: item.offers?.price ?? null,
        currency: item.offers?.priceCurrency ?? "CZK",
        fuel: item.fuelType ?? null,
        transmission: item.vehicleTransmission ?? null,
        // Not in the ld+json payload; best-effort parse from the title text
        // (e.g. "Ford Tourneo Custom 2.0 EcoBlue 125 kW") when present.
        powerKw: extractPowerKw(item.name ?? ""),
        body: item.bodyType ?? null,
        color: item.color ?? null,
        location: null,
        country: "CZ",
        sellerType: "dealer",
        vin: null,
        imageUrls: item.image ?? [],
      });
    }
  }
  return out;
}

/** Parses a listing detail page's equipment chip list — confirmed live:
 * `.detail-equipment__item` spans hold every equipment label shown under the
 * page's "Výbava" section (the ld+json `description` on this page is just
 * the auto-generated title/spec line, no free text worth adding). Exported
 * for unit testing without a live call. */
export function parseAaaAutoDetailText(html: string): string | null {
  const $ = cheerio.load(html);
  const items = $(".detail-equipment__item")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return items.length > 0 ? items.join(" ") : null;
}

export const aaaautoAdapter: SourceAdapter = {
  id: "aaaauto",
  verified: true,
  async fetchDetailText(listing: { url: string; sourceId: string }): Promise<string | null> {
    try {
      const html = await fetchText(listing.url);
      return parseAaaAutoDetailText(html);
    } catch (err) {
      console.warn(`[aaaauto] fetchDetailText failed for ${listing.sourceId}:`, (err as Error).message);
      return null;
    }
  },
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    let hitCap = false;
    for (let page = 0; page < maxPages; page++) {
      const url = buildAaaAutoUrl(query, page);
      let html: string;
      try {
        const fetched = await fetchTextWithUrl(url);
        // aaaauto.cz redirects ANY make/model path segment it doesn't
        // recognize all the way back to its bare unfiltered `/ojete-vozy`
        // root (confirmed live — see `audiQ8EtronFallbackSlug`'s doc comment
        // and, for a make it simply doesn't stock at all, e.g. RAM/Maxus/
        // LDV/Piaggio). Every model-specific quirk we know about is already
        // translated away above before the request is even made; this is a
        // safety net for the rest (mainly: an unstocked make) — without it,
        // following the redirect would silently ingest aaaauto's FULL
        // cross-brand catalog instead of correctly reporting zero results
        // for this make.
        if (query.make && new URL(fetched.finalUrl).pathname === "/ojete-vozy" && new URL(url).pathname !== "/ojete-vozy") {
          console.warn(`[aaaauto] make/model not recognized (redirected to unfiltered listing): ${url}`);
          break;
        }
        html = fetched.html;
      } catch (err) {
        const message = (err as Error).message;
        console.warn(`[aaaauto] request failed on page ${page}:`, message);
        // A first-page failure means this query got NO data at all, not
        // "pagination happened to stop here" — surface it as a real error
        // (see the per-query catch in runner.ts) instead of silently
        // returning zero results with nothing to show for it.
        if (page === 0) throw new Error(`[aaaauto] request failed on page 0: ${message}`);
        break;
      }
      const items = parseAaaAutoHtml(html);
      if (items.length === 0 && page === 0 && !looksLikeAaaAutoListingPage(html)) {
        // Got a 200 on the exact URL we asked for (not the redirect-to-root
        // case above), but it doesn't look like a real aaaauto.cz page at
        // all — not even the markers a genuinely empty result still has
        // (see looksLikeAaaAutoListingPage). Most likely a bot-mitigation/
        // geo-block page silently swapped in instead of the real one; treat
        // it as an error rather than reporting a (wrong) zero.
        throw new Error(
          `[aaaauto] response doesn't look like a real aaaauto.cz page (possible bot/geo-block) at ${url}`
        );
      }
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
      if (page === maxPages - 1) hitCap = true;
    }
    if (hitCap) ctx.onPageCapHit?.();
    console.log(`[aaaauto] fetched ${out.length} listings`);
    return out;
  },
};
