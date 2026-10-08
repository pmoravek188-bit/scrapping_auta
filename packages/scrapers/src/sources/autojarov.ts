/**
 * Auto Jarov (autojarov.cz) adapter — VERIFIED live 2026-10-08.
 *
 * Auto Jarov (Praha 3 - Jarov / Praha 4 - Kunratice) is a multi-brand
 * Škoda/Volkswagen-Group + Honda franchise dealer that bills itself as the
 * largest single car dealership in the Czech Republic. This is its OWN used
 * stock, not an aggregator — confirmed live the unfiltered
 * `/nabidka-vozu/typy_ojete/` search paginates to page 59 at 12 cards/page
 * (~700 cars).
 *
 * URL structure (server-rendered HTML, Nette Framework; the
 * "searchEngine-listVehicles-..." element-id naming is this dealer-CMS
 * vendor's own convention, shared with autopalace.ts but with a visibly
 * different card template between the two sites, so no parsing code is
 * shared between them):
 *   - `https://www.autojarov.cz/nabidka-vozu/typy_ojete/` — all used cars.
 *   - `.../typy_ojete/znacky_<slug>/` — one brand, confirmed live
 *     server-side (e.g. `znacky_skoda` vs `znacky_volkswagen` return
 *     disjoint result sets, not the full inventory).
 *   - Pagination: `.../<n>/` (1-based; 2nd page is `/2/`), confirmed live,
 *     and confirmed live to compose with the brand segment
 *     (`znacky_skoda/2/`).
 *   - Page size: 12 cards/page, confirmed live.
 *
 * VW SPLIT BRAND: confirmed live this dealer lists Volkswagen passenger cars
 * (Golf, Passat, T-Roc, ...) under `znacky_volkswagen`, and Volkswagen
 * commercial/leisure models — Multivan, Caddy (incl. "Caddy Maxi"),
 * California, Amarok, ID. Buzz — under a SEPARATE `znacky_volkswagen-
 * uzitkove-vozy` ("VW commercial vehicles") brand slug. The two are
 * disjoint, confirmed live (`znacky_volkswagen` returned zero Multivan/Caddy
 * listings). Since this app's canonical `normalizeMake` treats both as
 * plain "volkswagen", `search()` below queries BOTH slugs for a volkswagen
 * query and merges the results — this is the main reason this source earns
 * its keep for this app's own most-searched models (VW Multivan, Caddy
 * Maxi). Each card's own make text ("Volkswagen Užitkové vozy") is
 * collapsed back to plain "volkswagen" in `parseAutoJarovHtml` below, since
 * `normalizeMake` would otherwise slugify it to the unrecognized
 * "volkswagen-uzitkove-vozy".
 *
 * MODEL FILTER: the site also has a `modely_<x>` path segment (seen in its
 * own nav for new cars), but `robots.txt` explicitly disallows it
 * (`Disallow: *ojete/modely_*` etc.) — not used here. Model-level filtering
 * is left to the runner's client-side matcher, same as autoesa.ts/havex.ts,
 * using make/model inferred per-card via `inferMakeModel`.
 *
 * CARD MARKUP: each result is `a.vehicle-smallCard[href]`, trailing numeric
 * id in the href (e.g. `...-2879672.html`). Inside: an `h4` whose own
 * leading text node is the bare make name ("Škoda", "Volkswagen Užitkové
 * vozy", ...), followed by a `<b>` with the model+trim text (e.g. "OCTAVIA
 * COMBI SPORTLINE 1,5 TSI 110 kW DSG"). A `ul.parameters` holds exactly 5
 * `li.col` items with NO semantic class/icon to key off (confirmed live) —
 * confirmed live to always be, in order, [transmission, fuel, power,
 * mileage, "M/YYYY" in-service date], but classified here by content
 * pattern rather than position, to stay robust if a listing is ever missing
 * one field. Price is the first (and, confirmed live, only) `.prices b`.
 * Location is `.stockStatus span`.
 *
 * ANTI-BOT: none observed — plain nginx/Nette server-rendered HTML, no
 * Cloudflare/JS challenge, confirmed live across a handful of throttled
 * requests (2026-10-08). `looksLikeAutoJarovListingPage` below still throws
 * on anything that doesn't look like the real template, the same defensive
 * pattern as autobazar.ts/aaaauto.ts, in case that changes under sustained
 * GitHub-Actions traffic.
 */
import * as cheerio from "cheerio";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { inferMakeModel, normalizeMake } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { extractPowerKw, guessFuel, guessTransmission, parseCzNumber } from "./_util-b.js";

const BASE_URL = "https://www.autojarov.cz";
const LIST_PATH = "/nabidka-vozu/typy_ojete";
const PAGE_SIZE = 12;

/** Brand slug(s) on this site for a given normalized make. Usually just the
 * make's own canonical slug — except Volkswagen, which this dealer splits
 * into a passenger-car brand page and a separate commercial-vehicle one
 * (see file header). `null` (no make given) means no brand filter at all. */
export function brandSlugsForAutoJarov(make: string | null | undefined): (string | null)[] {
  const normalized = normalizeMake(make);
  if (!normalized) return [null];
  if (normalized === "volkswagen") return ["volkswagen", "volkswagen-uzitkove-vozy"];
  return [normalized];
}

export function buildAutoJarovUrl(brandSlug: string | null, page: number): string {
  const segments = [LIST_PATH];
  if (brandSlug) segments.push(`znacky_${brandSlug}`);
  if (page > 0) segments.push(String(page + 1));
  return `${BASE_URL}${segments.join("/")}/`;
}

/** True if `html` looks like a real autojarov.cz search-results page
 * (confirmed live: every real page — with matching cars or genuinely zero —
 * renders this container as part of the base template). False means
 * something else got served instead (block page, maintenance page, ...) —
 * `search()` throws rather than silently reporting zero results, same
 * pattern as autobazar.ts's `looksLikeAutobazarListingPage`. */
export function looksLikeAutoJarovListingPage(html: string): boolean {
  return html.includes("vehicles-list");
}

const TRANSMISSION_HINT_RE = /p[řr]evodovka/i;
const DATE_RE = /^(\d{1,2})\s*\/\s*(\d{4})$/;
const POWER_RE = /^\d{1,4}\s*kw$/i;
const MILEAGE_HINT_RE = /km/i;

export function parseAutoJarovHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];

  $("a.vehicle-smallCard").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    const idMatch = href.match(/-(\d+)\.html$/);
    const sourceId = idMatch?.[1] ?? href;

    const h4 = $el.find("h4").first();
    const rawMakeText = h4.clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    const variantText = h4.find("b").first().text().replace(/\s+/g, " ").trim();

    let make = normalizeMake(rawMakeText);
    // This dealer's own "Volkswagen Užitkové vozy" (commercial-vehicles)
    // brand label slugifies to "volkswagen-uzitkove-vozy", which isn't a
    // make this app otherwise recognizes — collapse back to plain
    // "volkswagen" (see file header: same make, just a separate brand page
    // on this dealer's own site).
    if (make === "volkswagen-uzitkove-vozy") make = "volkswagen";

    const { model } = inferMakeModel(variantText, make ?? undefined);

    let transmission: string | null = null;
    let fuel: string | null = null;
    let powerKw: number | null = null;
    let mileageKm: number | null = null;
    let year: number | null = null;
    $el.find("ul.parameters li").each((__, liEl) => {
      const text = $(liEl).text().replace(/\s+/g, " ").trim();
      if (!text) return;
      const dateMatch = DATE_RE.exec(text);
      if (TRANSMISSION_HINT_RE.test(text)) transmission = guessTransmission(text);
      else if (dateMatch) year = Number(dateMatch[2]);
      else if (MILEAGE_HINT_RE.test(text)) mileageKm = parseCzNumber(text);
      else if (POWER_RE.test(text)) powerKw = extractPowerKw(text) ?? parseCzNumber(text);
      else fuel = guessFuel(text) ?? fuel;
    });

    const price = parseCzNumber($el.find(".prices b").first().text());
    const location = $el.find(".stockStatus span").first().text().trim() || null;
    const imgSrc = $el.find("img").first().attr("src");
    const imageUrls = imgSrc ? [imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`] : [];

    out.push({
      sourceId,
      url,
      title: [rawMakeText, variantText].filter(Boolean).join(" "),
      make,
      model,
      variant: variantText || null,
      year,
      mileageKm,
      price,
      currency: "CZK",
      fuel,
      transmission,
      powerKw,
      body: null,
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

export const autojarovAdapter: SourceAdapter = {
  id: "autojarov",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const brandSlugs = brandSlugsForAutoJarov(query.make);
    const out: RawListing[] = [];
    let hitCap = false;
    for (let slugIdx = 0; slugIdx < brandSlugs.length; slugIdx++) {
      const brandSlug = brandSlugs[slugIdx] ?? null;
      for (let page = 0; page < maxPages; page++) {
        const url = buildAutoJarovUrl(brandSlug, page);
        let html: string;
        try {
          html = await fetchText(url);
        } catch (err) {
          const message = (err as Error).message;
          console.warn(`[autojarov] request failed on page ${page} (brand=${brandSlug}):`, message);
          // Only the very first fetch of the whole search throwing means
          // "this source is likely down/blocked" — a later brand slug (e.g.
          // the volkswagen-uzitkove-vozy half of a volkswagen query) failing
          // its own page 0 just means that half comes back empty, same as
          // running out of results.
          if (slugIdx === 0 && page === 0) {
            throw new Error(`[autojarov] request failed on page 0: ${message}`);
          }
          break;
        }
        if (!looksLikeAutoJarovListingPage(html)) {
          throw new Error(
            `[autojarov] response doesn't look like a real autojarov.cz page (possible block) at ${url}`
          );
        }
        const items = parseAutoJarovHtml(html);
        out.push(...items);
        if (items.length < PAGE_SIZE) break;
        if (page === maxPages - 1) hitCap = true;
      }
    }
    if (hitCap) ctx.onPageCapHit?.();
    console.log(`[autojarov] fetched ${out.length} listings`);
    return out;
  },
};
