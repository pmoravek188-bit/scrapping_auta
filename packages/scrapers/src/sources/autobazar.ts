/**
 * Autobazar.eu adapter — VERIFIED live 2026-10-07 against
 * `https://www.autobazar.eu/cs/vysledky/osobne-vozidla/?...`. `autobazar.cz`
 * 301-redirects to this same `autobazar.eu` site (`?location=...` already
 * scoped to Czech Republic), confirmed live — this is one source, not two.
 *
 * The page is a Next.js (pages-router) SSR page that embeds the full first
 * page of results as JSON in `<script id="__NEXT_DATA__">` at
 * `props.pageProps.searchRecords.data` — no separate API call needed, same
 * pattern as autoscout24.ts.
 *
 * SERVER-SIDE FILTERS confirmed live by diffing `props.pageProps.searchRecords.total`:
 * - `location=200000000`: the Czech-Republic-root location id — confirmed
 *   live every listing returned with it set has `location.parentNames`
 *   ending in "Česká republika" (this site also serves SK/HU/AT inventory
 *   under other location ids; omitting this param, or using a plain `znacka=`
 *   param instead of `brandSef=` below, silently returns the ENTIRE
 *   cross-country top/premium-sponsored feed instead of a real filtered
 *   result — see the next bullet).
 * - `brandSef`/`modelSef`: the make/model filter, confirmed live — MUST be
 *   these exact param names with the site's own lowercase slug
 *   ("volkswagen"/"multivan", no diacritics). A same-named plain `brand=`/
 *   `model=`/`znacka=` query param is silently accepted into the echoed
 *   `searchQuery` but has NO filtering effect at all (confirmed live:
 *   `model=multivan` with no `modelSef` returned unrelated Škoda/BMW/Porsche
 *   top-sponsored listings, total unchanged from the brand's full count) —
 *   this cost significant live-debugging time, so it's called out here
 *   explicitly for the next person touching this file.
 * - `yearFrom`/`yearTo`, `priceFrom`/`priceTo`, `mileageTo`: confirmed live,
 *   each one independently narrows `total` (e.g. `priceTo=3000` on a
 *   BMW 3-series query dropped `total` from 27 to 1).
 * - `fuelSef`/`gearboxSef`/`driveSef`/`bodyworkSef` (guessed from the
 *   brand/modelSef naming pattern): tried live, NOT echoed into
 *   `searchQuery` at all (unlike the confirmed params above) — the site
 *   doesn't recognize these names, so they're omitted here and left to the
 *   runner's client-side matcher, same as sauto's unmapped BODY_SEO_MAP
 *   entries.
 *
 * PRICE/CURRENCY: confirmed live the site displays (and filters
 * `priceFrom`/`priceTo` in) EUR regardless of the listing's original
 * currency — e.g. a Czech-location Ford Tourneo Custom had `price: 259900`
 * (its CZK list price) but `finalPrice`/`priceCurrent: 10652.08` (the exact
 * same EUR-converted number for both), while a different listing's `price`
 * and `priceCurrent` were identical (that seller apparently priced directly
 * in EUR) — there's no explicit currency field to tell these apart, so
 * `finalPrice` (falling back to `priceCurrent`) is used as the one
 * consistently-EUR number, converted to CZK via `ctx.eurCzkRate` exactly
 * like autoscout24.ts (same outward-rounding rationale for the request
 * filter; the runner's own matcher re-checks the exact bound afterwards).
 *
 * Mercedes-Benz lettered classes: UNCONFIRMED on this source — live checks
 * got blocked (see `looksLikeAutobazarListingPage`) before a class-letter
 * query could be tried. `buildAutobazarUrl` falls back to the default
 * slugified model for Mercedes-Benz for now (a wrong guess here just means
 * zero results from this adapter for that one query, not a wrong/cross-model
 * result — `modelSef` filtering confirmed-live, see above). Fix forward once
 * confirmed, the same way sauto/aaaauto/autoscout24 each record their own
 * confirmed class-letter slug.
 *
 * ANTI-BOT: this site is NOT behind an always-on JS challenge (Cloudflare/
 * DataDome) — a plain GET with a realistic browser UA (this app's
 * `http.ts` default) gets the real SSR page every time *in isolation*. BUT:
 * confirmed live during this adapter's own research, a burst of ~20
 * requests in a couple of minutes from one IP first got some requests
 * swapped for an F5-style WAF interstitial (`<title>Request Rejected</title>`,
 * HTTP 200, no `__NEXT_DATA__` at all — see the live-captured fixture
 * `autobazar-blocked-live.html`), and shortly after that, ALL requests
 * (even a bare `/robots.txt`) started failing to connect at all from that
 * same IP. This looks like escalating IP-reputation-based bot mitigation,
 * NOT confirmed to reproduce under this app's actual 2-5s-per-request
 * throttle (`http.ts`'s `politeFetch`) — but a shared/reused datacenter IP
 * range (GitHub Actions) is exactly the kind of IP such reputation systems
 * pre-flag, and a full nightly run (many saved searches × many pages each)
 * is a much larger burst than this adapter's own research probing. This can
 * only be confirmed one way or the other by an actual GitHub Actions run —
 * `looksLikeAutobazarListingPage` below exists specifically so a swapped-in
 * WAF/interstitial page throws instead of silently reporting zero results
 * (same reasoning/pattern as aaaauto.ts's `looksLikeAaaAutoListingPage`).
 */
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { bmwSeriesNumber, normalizeMake, slugifyMakeModel, vwIdModelUrlSlug } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const BASE_URL = "https://www.autobazar.eu";
const SEARCH_PATH = "/cs/vysledky/osobne-vozidla/";
/** The Czech-Republic-root `location` id — see file header. Confirmed live:
 * every result returned with this set had `location.parentNames` ending in
 * "Česká republika". */
const LOCATION_CZ = "200000000";
/** `category_id` for passenger cars ("Osobné vozidlá" — confirmed live on
 * every search page's own echoed `searchQuery.category`). */
const CATEGORY_OSOBNI = "30900";
const PAGE_SIZE = 20;

export function buildAutobazarUrl(query: SearchQuery, page: number, eurCzkRate: number): string {
  const params = new URLSearchParams();
  params.set("location", LOCATION_CZ);
  params.set("category", CATEGORY_OSOBNI);
  // Confirmed live (the hard way — this 404s otherwise): an explicit
  // `page=1` 404s on this site, for EVERY query, including ones with far
  // more than one page of results. Page 1 must be requested with NO `page`
  // param at all; `page=2`, `page=3`, ... work as plain literal numbers.
  if (page > 0) params.set("page", String(page + 1));

  if (query.make) {
    const makeSlug = slugifyMakeModel(query.make);
    params.set("brandSef", makeSlug);
    if (query.model) {
      const isBmw = normalizeMake(query.make) === "bmw";
      const n = isBmw ? bmwSeriesNumber(query.model) : null;
      const vwIdSlug = normalizeMake(query.make) === "volkswagen" ? vwIdModelUrlSlug(query.model) : null;
      // BMW numbered series: this site's own sefName is Slovak "rad-<n>"
      // ("Rad 3"), confirmed live (e.g. /brandSef=bmw/modelSef=rad-3 ->
      // totalItems narrows to the 3-series-only count) — distinct from
      // sauto's Czech "rada-<n>" spelling, so NOT reusing bmwSeriesNumber's
      // output directly without the site-specific prefix.
      const modelSef = n ? `rad-${n}` : (vwIdSlug ?? slugifyMakeModel(query.model));
      params.set("modelSef", modelSef);
    }
  }
  // priceFrom/priceTo are CZK; this site filters (and displays) EUR.
  // Round the range OUTWARD (floor the min, ceil the max) so the
  // server-side filter never excludes a listing that would actually match
  // once converted back to CZK — same rationale as autoscout24.ts.
  if (query.priceFrom) params.set("priceFrom", String(Math.floor(query.priceFrom / eurCzkRate)));
  if (query.priceTo) params.set("priceTo", String(Math.ceil(query.priceTo / eurCzkRate)));
  if (query.yearFrom) params.set("yearFrom", String(query.yearFrom));
  if (query.yearTo) params.set("yearTo", String(query.yearTo));
  if (query.mileageMax) params.set("mileageTo", String(query.mileageMax));
  return `${BASE_URL}${SEARCH_PATH}?${params.toString()}`;
}

interface AbImagePreview {
  previewUrls?: { orig?: string | null } | null;
}
interface AbLocation {
  name?: string | null;
  parentNames?: string[] | null;
}
interface AbAd {
  id?: string;
  sefName?: string;
  title?: string;
  brandValue?: string | null;
  carModelValue?: string | null;
  yearValue?: string | null;
  mileage?: number | null;
  finalPrice?: number | null;
  priceCurrent?: number | null;
  fuelValue?: string | null;
  gearboxValue?: string | null;
  driveValue?: string | null;
  enginePower?: number | null;
  bodyworkValue?: string | null;
  vin?: string | null;
  location?: AbLocation | null;
  image?: AbImagePreview | null;
  images?: AbImagePreview[] | null;
}
interface AbNextData {
  props?: {
    pageProps?: {
      searchRecords?: { data?: AbAd[]; total?: number };
    };
  };
}

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function extractNextData(html: string): AbNextData | null {
  const m = NEXT_DATA_RE.exec(html);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]) as AbNextData;
  } catch {
    return null;
  }
}

/** True if `html` looks like a real autobazar.eu search page (confirmed
 * live: every real page — whether it has matching cars or genuinely zero —
 * embeds `props.pageProps.searchRecords` in its `__NEXT_DATA__`). False
 * means the response is something else — confirmed live: the F5-style WAF
 * interstitial this adapter hit during its own research (HTTP 200,
 * `<title>Request Rejected</title>`, no `__NEXT_DATA__` script at all, see
 * the file header) — `search()` below treats that as a real error instead
 * of silently reporting zero results. */
export function looksLikeAutobazarListingPage(html: string): boolean {
  const data = extractNextData(html);
  return data?.props?.pageProps?.searchRecords != null;
}

function yearFromValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 1900 ? n : null;
}

/** Confirmed live: some ads carry a junk placeholder `vin` (e.g. the literal
 * string `"0"`) instead of omitting the field — a real VIN is always 17
 * chars (occasionally a little short/long in the wild for older cars), so
 * anything implausibly short is treated as absent rather than stored as a
 * fake VIN. */
function plausibleVin(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.length >= 10 ? v : null;
}

export function parseAutobazarHtml(html: string): RawListing[] {
  const data = extractNextData(html);
  const ads = data?.props?.pageProps?.searchRecords?.data ?? [];
  const out: RawListing[] = [];
  for (const ad of ads) {
    if (!ad.id || !ad.sefName) continue;
    const images = (ad.images && ad.images.length > 0 ? ad.images : ad.image ? [ad.image] : [])
      .map((i) => i?.previewUrls?.orig)
      .filter((u): u is string => Boolean(u));
    out.push({
      sourceId: ad.id,
      url: `${BASE_URL}/cs/detail/${ad.sefName}/${ad.id}/`,
      title: ad.title ?? "",
      make: ad.brandValue ?? null,
      model: ad.carModelValue ?? null,
      variant: null,
      year: yearFromValue(ad.yearValue),
      mileageKm: ad.mileage ?? null,
      price: ad.finalPrice ?? ad.priceCurrent ?? null,
      currency: "EUR",
      fuel: ad.fuelValue ?? null,
      transmission: ad.gearboxValue ?? null,
      powerKw: ad.enginePower ?? null,
      body: ad.bodyworkValue ?? null,
      color: null,
      location: ad.location?.name ?? null,
      country: "CZ",
      sellerType: null,
      vin: plausibleVin(ad.vin),
      imageUrls: images,
      drive: ad.driveValue ?? null,
    });
  }
  return out;
}

export const autobazarAdapter: SourceAdapter = {
  id: "autobazar",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    let hitCap = false;
    for (let page = 0; page < maxPages; page++) {
      const url = buildAutobazarUrl(query, page, ctx.eurCzkRate);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        const message = (err as Error).message;
        console.warn(`[autobazar] request failed on page ${page}:`, message);
        if (page === 0) throw new Error(`[autobazar] request failed on page 0: ${message}`);
        break;
      }
      if (!looksLikeAutobazarListingPage(html)) {
        throw new Error(
          `[autobazar] response doesn't look like a real autobazar.eu page (possible bot-mitigation/WAF block) at ${url}`
        );
      }
      const items = parseAutobazarHtml(html);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
      if (page === maxPages - 1) hitCap = true;
    }
    if (hitCap) ctx.onPageCapHit?.();
    console.log(`[autobazar] fetched ${out.length} listings`);
    return out;
  },
};
