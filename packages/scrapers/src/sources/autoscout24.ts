/**
 * AutoScout24 (autoscout24.cz) adapter — VERIFIED live 2026-09-28.
 *
 * The old stub used `makeGenericHtmlAdapter` with placeholder selectors and
 * returned 0 results. The real search page
 * (`https://www.autoscout24.cz/lst?...`) is a Next.js SSR page that embeds
 * the full first page of results as JSON in `<script id="__NEXT_DATA__">`
 * at `props.pageProps.listings` — no separate API call needed.
 *
 * SCOPE (per explicit user decision, 2026-09-28): Germany only, `cy=D`
 * (confirmed live: `numberOfResults` for `cy=D` alone is ~830k, all
 * `location.countryCode: "DE"`). AutoScout24's Czech site has no Czech
 * domestic inventory at all — the default (no `cy`) search spans
 * `D,A,B,E,F,I,L,NL`, and explicitly forcing `cy=CZ` returns 0 results — so
 * Germany is the closest thing to a curated, single-country inventory here.
 *
 * Make/model server-side filtering is a URL path, confirmed live:
 * `/lst/<makeSlug>/<modelSlug>` (e.g. `/lst/skoda/octavia`,
 * `numberOfResults` changes accordingly). Year/mileage filters are query
 * params, confirmed live via `numberOfResults` narrowing: `fregfrom`,
 * `fregto` (first-registration year), `kmto` (max mileage). Pagination:
 * `page` (1-based) + `size`.
 *
 * PRICE: `SearchQuery.priceFrom`/`priceTo` are in CZK (the app's canonical
 * currency); AS24's `pricefrom`/`priceto` params are EUR, so they're
 * converted with `ctx.eurCzkRate`, rounding the range OUTWARD (floor the
 * min, ceil the max) so a borderline listing is never wrongly excluded by
 * the server-side filter — the runner's `matchesSearch` re-checks the exact
 * CZK bound afterwards anyway.
 *
 * PRICE FIELD / VAT: confirmed live there is only ONE price object per
 * listing (no separate `leasingRate`/`creditRate`/monthly field anywhere in
 * the payload, unlike e.g. dasweltauto) — `price.priceRaw` is the real
 * asking price, not a financing rate (one listing's very low price carried
 * `tracking.priceLabel: "toolow-price"`, which is AS24 flagging the price
 * as anomalously cheap for the model, not a different price type).
 * `price.isVatLabelLegallyRequired` is the field behind AS24's
 * `shared.footnotes.vatDeductible` ("Odpočitatelné DPH") UI label —
 * confirmed by finding that exact translation string served alongside this
 * field on the search page. CORRECTION (2026-09-28, second review): this
 * flag does NOT mean the price is net-of-VAT — on AutoScout24 the displayed
 * `priceRaw`/`priceFormatted` is *always* the gross (VAT-included) price;
 * the flag only means VAT is statable/reclaimable for a business buyer
 * ("MwSt. ausweisbar"), which is a legal-disclosure requirement, not a
 * different price base. An earlier version of this adapter wrongly
 * multiplied `priceRaw` by 1.19 when this flag was set, which would have
 * *overstated* those listings' prices by 19%. Checked specifically for an
 * explicit net-price field/indicator (`netPrice`, "Nettopreis", a
 * `priceType`/gross-vs-net marker) across several live pages/makes and
 * found none anywhere in the payload — only the single `price.priceRaw`
 * number exists — so there is nothing to gross up in the first place. Fixed:
 * `priceRaw` is now always used as-is; the flag only adds a visible
 * " · odpočet DPH" suffix to the title, no price arithmetic. (Also checked:
 * across ~270 sampled live listings — several makes, several pages — this
 * flag was `false` on every single one seen, so it appears to be rarely if
 * ever set on the `.cz`-served payload; the handling is kept for
 * correctness in case it does occur.)
 *
 * `title` = `${make} ${model} ${modelVersionInput}` (previously just
 * `modelVersionInput`, e.g. "1.6 Lauréate 88 pk dis riem v.v 117 dkm 2022
 * airco" with no make/model at all).
 *
 * `year`: previously scraped from a stray 4-digit number inside
 * `modelVersionInput`, which is frequently absent. Confirmed live that
 * every listing instead carries `tracking.firstRegistration` as a reliable
 * `"MM-YYYY"` string (e.g. `"02-2003"`) — used for `year` now, with the old
 * free-text scan kept as a fallback.
 *
 * `powerKw`: previously left `null`; confirmed live that `vehicleDetails[]`
 * always includes one entry with `iconName: "speedometer"` and
 * `data: "<N> kW (<M> hp)"` — parsed for `powerKw` now.
 *
 * `location`/`country`: `location.city` + `location.zip`, `country` fixed
 * to `"DE"` (this adapter only ever queries `cy=D`).
 */
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { slugifyMakeModel } from "@scrapping-auta/core";
import { fetchText, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";
import { guessFuel, guessTransmission } from "./_util-b.js";

const BASE_URL = "https://www.autoscout24.cz";
const PAGE_SIZE = 20;

interface As24Price {
  priceRaw?: number | null;
  isVatLabelLegallyRequired?: boolean | null;
}

interface As24Location {
  countryCode?: string | null;
  city?: string | null;
  zip?: string | null;
}

interface As24Vehicle {
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  modelVersionInput?: string | null;
  transmission?: string | null;
  fuel?: string | null;
  mileageInKm?: string | null;
}

interface As24VehicleDetail {
  data?: string | null;
  iconName?: string | null;
}

interface As24Tracking {
  firstRegistration?: string | null;
}

interface As24Listing {
  id?: string;
  url?: string;
  price?: As24Price;
  location?: As24Location;
  vehicle?: As24Vehicle;
  images?: string[];
  vehicleDetails?: As24VehicleDetail[];
  tracking?: As24Tracking;
}

interface As24NextData {
  props?: {
    pageProps?: {
      numberOfResults?: number;
      listings?: As24Listing[];
    };
  };
}

export function buildAutoScout24Url(
  query: SearchQuery,
  page: number,
  eurCzkRate: number
): string {
  let path = "/lst";
  if (query.make) {
    path += `/${slugifyMakeModel(query.make)}`;
    if (query.model) path += `/${slugifyMakeModel(query.model)}`;
  }
  const params = new URLSearchParams();
  params.set("sort", "standard");
  params.set("desc", "0");
  params.set("ustate", "N,U");
  params.set("size", String(PAGE_SIZE));
  params.set("page", String(page + 1));
  params.set("cy", "D");
  // priceFrom/priceTo are CZK; AS24 wants EUR. Round the range OUTWARD
  // (floor the min, ceil the max) so the server-side filter never excludes
  // a listing that would actually match once converted back to CZK.
  if (query.priceFrom) {
    params.set("pricefrom", String(Math.floor(query.priceFrom / eurCzkRate)));
  }
  if (query.priceTo) {
    params.set("priceto", String(Math.ceil(query.priceTo / eurCzkRate)));
  }
  if (query.yearFrom) params.set("fregfrom", String(query.yearFrom));
  if (query.yearTo) params.set("fregto", String(query.yearTo));
  if (query.mileageMax) params.set("kmto", String(query.mileageMax));
  return `${BASE_URL}${path}?${params.toString()}`;
}

function parseKm(text: string | null | undefined): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

/** "MM-YYYY" (e.g. "02-2003") -> 2003. */
function yearFromFirstRegistration(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\d{1,2}-(\d{4})$/.exec(text.trim());
  return m ? Number(m[1]) : null;
}

/** Finds the "<N> kW (<M> hp)" entry in `vehicleDetails` and returns N. */
function powerKwFromDetails(details: As24VehicleDetail[] | undefined): number | null {
  const entry = details?.find((d) => d.iconName === "speedometer");
  const m = /(\d{2,4})\s*kw/i.exec(entry?.data ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * The buyer-facing purchase price. `priceRaw` is always the gross
 * (VAT-included) price on AutoScout24 — see file header — so this is a
 * thin, explicit accessor rather than a no-op inline read, to make clear no
 * VAT arithmetic happens here on purpose.
 */
export function purchasePriceEur(price: As24Price | undefined): number | null {
  const raw = price?.priceRaw;
  return typeof raw === "number" ? raw : null;
}

export function parseAutoScout24Html(html: string): RawListing[] {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) return [];
  let data: As24NextData;
  try {
    data = JSON.parse(m[1]) as As24NextData;
  } catch {
    return [];
  }
  const listings = data.props?.pageProps?.listings ?? [];
  const out: RawListing[] = [];

  for (const l of listings) {
    if (!l.id || !l.url) continue;
    const v = l.vehicle ?? {};
    const vatDeductible = Boolean(l.price?.isVatLabelLegallyRequired);
    const baseTitle = [v.make, v.model, v.modelVersionInput].filter(Boolean).join(" ");
    const title = vatDeductible ? `${baseTitle} · odpočet DPH` : baseTitle;
    const year =
      yearFromFirstRegistration(l.tracking?.firstRegistration) ??
      // Fall back to a stray 4-digit year in the free-text model version,
      // in case `tracking.firstRegistration` is ever missing.
      (() => {
        const ym = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(v.modelVersionInput ?? "");
        return ym ? Number(ym[1]) : null;
      })();
    const location = [l.location?.city, l.location?.zip].filter(Boolean).join(" ") || null;

    out.push({
      sourceId: l.id,
      url: l.url.startsWith("http") ? l.url : `${BASE_URL}${l.url}`,
      title,
      make: v.make ?? null,
      model: v.model ?? null,
      variant: v.variant ?? null,
      year,
      mileageKm: parseKm(v.mileageInKm),
      price: purchasePriceEur(l.price),
      currency: "EUR",
      fuel: guessFuel(v.fuel ?? ""),
      transmission: guessTransmission(v.transmission ?? ""),
      powerKw: powerKwFromDetails(l.vehicleDetails),
      body: null,
      color: null,
      location,
      country: "DE",
      sellerType: "dealer",
      vin: null,
      imageUrls: l.images ?? [],
    });
  }

  return out;
}

export const autoscout24Adapter: SourceAdapter = {
  id: "autoscout24",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildAutoScout24Url(query, page, ctx.eurCzkRate);
      let html: string;
      try {
        html = await fetchText(url);
      } catch (err) {
        console.warn(`[autoscout24] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseAutoScout24Html(html);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    console.log(`[autoscout24] fetched ${out.length} listings`);
    return out;
  },
};
