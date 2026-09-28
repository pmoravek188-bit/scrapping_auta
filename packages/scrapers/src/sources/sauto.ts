/**
 * Sauto.cz adapter — VERIFIED live 2026-09-28 against
 * `https://www.sauto.cz/api/v1/items/search?...&category_id=838` (838 =
 * "Osobní" / passenger cars, required or the API returns all categories
 * mixed together). Response shape: `{ pagination: { total }, results: [...] }`.
 *
 * Confirmed via curl against the live site:
 * - Items carry `manufacturer_cb`/`model_cb` as `{name, seo_name}` objects,
 *   `additional_model_name` (free-text variant/trim), `price` (CZK, number),
 *   `tachometer` (km), `fuel_cb`/`gearbox_cb` as `{name, seo_name}`,
 *   `in_operation_date`/`manufacturing_date` as `"YYYY-MM-DD"` or null,
 *   `locality.district`/`locality.region`, `premise` (non-null object =>
 *   dealer, otherwise a bare `user: {id}` => private seller), and
 *   `images: [{url: "//d19-a.sdn.cz/..."}]` (protocol-relative, needs
 *   `https:` prefix). There is NO `seo_url` field — detail URLs must be
 *   built manually.
 * - Detail URL: `https://www.sauto.cz/osobni/detail/{manufacturer_cb.seo_name}/{model_cb.seo_name}/{id}`.
 * - `power` (kW) is essentially never present on list items (only on the
 *   detail page), so `powerKw` is usually null here — that's expected.
 * - Server-side filters confirmed live: `manufacturer_model_seo` (e.g.
 *   `skoda` or `skoda:octavia`, lowercase seo slugs), `price_from`,
 *   `price_to`, `tachometer_to`, `vehicle_age_from`/`vehicle_age_to`
 *   (registration year), `fuel_seo`, `gearbox_seo` (`manualni`/`automaticka`),
 *   `vehicle_body_seo` (only some body types map cleanly — see
 *   `BODY_SEO_MAP` below), `engine_power_from` (kW). Unmapped enum values are
 *   simply omitted from the query and left to the runner's client-side
 *   matcher.
 */
import { z } from "zod";
import type { RawListing, SearchQuery, FuelType, TransmissionType } from "@scrapping-auta/core";
import { fetchJson, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const SEARCH_ENDPOINT = "https://www.sauto.cz/api/v1/items/search";
const CATEGORY_ID_OSOBNI = 838;
const PAGE_SIZE = 40;

/** SearchQuery FuelType -> sauto `fuel_seo` query value. Confirmed live; unmapped => omit filter. */
const FUEL_SEO_MAP: Partial<Record<FuelType, string>> = {
  petrol: "benzin",
  diesel: "nafta",
  electric: "elektro",
  hybrid: "hybridni",
  lpg: "lpg-benzin",
  cng: "cng-benzin",
  // plugin_hybrid and other: no dedicated seo slug found live, omit.
};

/** SearchQuery TransmissionType -> sauto `gearbox_seo`. Confirmed live. */
const GEARBOX_SEO_MAP: Record<TransmissionType, string> = {
  manual: "manualni",
  automatic: "automaticka",
};

/** SearchQuery BodyType -> sauto `vehicle_body_seo`. Only entries confirmed live are mapped;
 * "sedan" has no working slug on sauto (tried limuzina, sedan-limuzina, ...) so it's left to
 * the client-side matcher. */
const BODY_SEO_MAP: Partial<Record<string, string>> = {
  hatchback: "hatchback",
  combi: "kombi",
  suv: "suv",
  coupe: "kupe",
  van: "van",
  pickup: "pick-up",
  cabrio: "kabriolet",
  mpv: "mpv",
};

export function buildSautoUrl(query: SearchQuery, offset: number, limit = PAGE_SIZE): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("category_id", String(CATEGORY_ID_OSOBNI));
  params.set("order", "timestamp_add");
  params.set("order_dir", "DESC");

  if (query.make) {
    const make = query.make.toLowerCase();
    const model = query.model?.toLowerCase();
    params.set("manufacturer_model_seo", model ? `${make}:${model}` : make);
  }
  if (query.yearFrom) params.set("vehicle_age_from", String(query.yearFrom));
  if (query.yearTo) params.set("vehicle_age_to", String(query.yearTo));
  if (query.priceFrom) params.set("price_from", String(query.priceFrom));
  if (query.priceTo) params.set("price_to", String(query.priceTo));
  if (query.mileageMax) params.set("tachometer_to", String(query.mileageMax));
  if (query.powerMinKw) params.set("engine_power_from", String(query.powerMinKw));
  const fuelFilter = query.fuel[0];
  if (query.fuel.length === 1 && fuelFilter) {
    const seo = FUEL_SEO_MAP[fuelFilter];
    if (seo) params.set("fuel_seo", seo);
  }
  if (query.transmission) {
    params.set("gearbox_seo", GEARBOX_SEO_MAP[query.transmission]);
  }
  const bodyFilter = query.body[0];
  if (query.body.length === 1 && bodyFilter) {
    const seo = BODY_SEO_MAP[bodyFilter];
    if (seo) params.set("vehicle_body_seo", seo);
  }
  return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

const CodebookSchema = z.object({
  name: z.string().nullable().optional(),
  seo_name: z.string().nullable().optional(),
});

const SautoItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().nullable().optional(),
  additional_model_name: z.string().nullable().optional(),
  manufacturer_cb: CodebookSchema.nullable().optional(),
  model_cb: CodebookSchema.nullable().optional(),
  manufacturing_date: z.string().nullable().optional(),
  in_operation_date: z.string().nullable().optional(),
  tachometer: z.number().nullable().optional(),
  price: z.number().nullable().optional(),
  fuel_cb: CodebookSchema.nullable().optional(),
  gearbox_cb: CodebookSchema.nullable().optional(),
  power: z.number().nullable().optional(),
  locality: z
    .object({
      district: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  premise: z.unknown().nullable().optional(),
  vin: z.string().nullable().optional(),
  images: z.array(z.object({ url: z.string().nullable().optional() })).nullable().optional(),
});

export interface SautoResponse {
  pagination?: { total?: number; limit?: number; offset?: number };
  results?: unknown[];
}

function yearFromDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})/.exec(dateStr);
  return m ? Number(m[1]) : null;
}

function normalizeImageUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export function parseSautoResponse(json: unknown): RawListing[] {
  const parsed = json as SautoResponse;
  const rawItems = parsed?.results ?? [];
  const out: RawListing[] = [];
  for (const item of rawItems) {
    const r = SautoItemSchema.safeParse(item);
    if (!r.success) continue;
    const v = r.data;
    const make = v.manufacturer_cb?.seo_name ?? null;
    const model = v.model_cb?.seo_name ?? null;
    const url =
      make && model
        ? `https://www.sauto.cz/osobni/detail/${make}/${model}/${v.id}`
        : `https://www.sauto.cz/osobni/detail/${v.id}`;
    const year = yearFromDate(v.in_operation_date) ?? yearFromDate(v.manufacturing_date);
    out.push({
      sourceId: String(v.id),
      url,
      title: v.name ?? [v.manufacturer_cb?.name, v.model_cb?.name].filter(Boolean).join(" "),
      make: v.manufacturer_cb?.name ?? null,
      model: v.model_cb?.name ?? null,
      variant: v.additional_model_name ?? null,
      year,
      mileageKm: v.tachometer ?? null,
      price: v.price ?? null,
      currency: "CZK",
      fuel: v.fuel_cb?.name ?? null,
      transmission: v.gearbox_cb?.name ?? null,
      powerKw: v.power ?? null,
      body: null,
      color: null,
      location: v.locality?.district ?? v.locality?.region ?? null,
      country: "CZ",
      sellerType: v.premise != null ? "dealer" : "private",
      vin: v.vin ?? null,
      imageUrls: (v.images ?? [])
        .map((i) => i.url)
        .filter((u): u is string => Boolean(u))
        .map(normalizeImageUrl),
    });
  }
  return out;
}

export const sautoAdapter: SourceAdapter = {
  id: "sauto",
  verified: true,
  async search(query: SearchQuery, ctx: SourceContext): Promise<RawListing[]> {
    const maxPages = ctx.maxPages ?? MAX_RESULT_PAGES;
    const out: RawListing[] = [];
    for (let page = 0; page < maxPages; page++) {
      const url = buildSautoUrl(query, page * PAGE_SIZE);
      let json: unknown;
      try {
        json = await fetchJson(url);
      } catch (err) {
        console.warn(`[sauto] request failed on page ${page}:`, (err as Error).message);
        break;
      }
      const items = parseSautoResponse(json);
      out.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    console.log(`[sauto] fetched ${out.length} listings`);
    return out;
  },
};
