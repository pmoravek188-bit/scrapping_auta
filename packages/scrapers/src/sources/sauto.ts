/**
 * Sauto.cz adapter — UNVERIFIED (best-guess from public knowledge / third-party
 * scraper projects; this sandbox cannot reach sauto.cz to confirm the exact
 * response shape). Sauto's frontend is known to call an internal JSON API at
 * `https://www.sauto.cz/api/v1/items/search`. Parsing is written defensively
 * with zod `safeParse` so a partial API shape change degrades gracefully
 * (fewer/zero results + a log line) instead of throwing.
 *
 * Real verification happens on the first GitHub Actions run — see README.
 */
import { z } from "zod";
import type { RawListing, SearchQuery } from "@scrapping-auta/core";
import { fetchJson, MAX_RESULT_PAGES } from "../http.js";
import type { SourceAdapter, SourceContext } from "../adapter.js";

const SEARCH_ENDPOINT = "https://www.sauto.cz/api/v1/items/search";
const PAGE_SIZE = 40;

export function buildSautoUrl(query: SearchQuery, offset: number, limit = PAGE_SIZE): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("order", "timestamp_add");
  params.set("order_dir", "DESC");
  if (query.make) params.set("manufacturer_cb_id", query.make);
  if (query.model) params.set("model_cb_id", query.model);
  if (query.yearFrom) params.set("year_from", String(query.yearFrom));
  if (query.yearTo) params.set("year_to", String(query.yearTo));
  if (query.priceFrom) params.set("price_from", String(query.priceFrom));
  if (query.priceTo) params.set("price_to", String(query.priceTo));
  if (query.mileageMax) params.set("tachometer_to", String(query.mileageMax));
  return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

// Loose schema: only fields we actually need are required-ish; everything
// else is optional so unexpected/missing fields don't blow up parsing.
const SautoItemSchema = z.object({
  advert_id: z.union([z.string(), z.number()]).nullable().optional(),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  seo_url: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  manufacturer_cb: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  model_cb: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  model_variant: z.string().nullable().optional(),
  manufacturing_date: z.union([z.string(), z.number()]).nullable().optional(),
  year: z.number().nullable().optional(),
  tachometer: z.number().nullable().optional(),
  price: z.number().nullable().optional(),
  fuel_cb: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  gearbox_cb: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  power: z.number().nullable().optional(),
  body_cb: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  color_cb: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  locality: z.object({ district: z.string().nullable().optional() }).nullable().optional(),
  seller_type: z.string().nullable().optional(),
  vin: z.string().nullable().optional(),
  images: z.array(z.object({ url: z.string().nullable().optional() })).nullable().optional(),
});

export interface SautoResponse {
  results?: unknown[];
  items?: unknown[];
  total?: number;
  count?: number;
}

export function parseSautoResponse(json: unknown): RawListing[] {
  const parsed = json as SautoResponse;
  const rawItems = parsed?.results ?? parsed?.items ?? [];
  const out: RawListing[] = [];
  for (const item of rawItems) {
    const r = SautoItemSchema.safeParse(item);
    if (!r.success) continue;
    const v = r.data;
    const id = v.advert_id ?? v.id;
    if (id == null) continue;
    const path = v.seo_url ?? v.url;
    if (!path) continue;
    const url = path.startsWith("http") ? path : `https://www.sauto.cz${path}`;
    const yearRaw = v.manufacturing_date ?? v.year;
    const year =
      typeof yearRaw === "number"
        ? yearRaw
        : typeof yearRaw === "string" && /^\d{4}/.test(yearRaw)
          ? Number(yearRaw.slice(0, 4))
          : null;
    out.push({
      sourceId: String(id),
      url,
      title: v.name ?? [v.manufacturer_cb?.name, v.model_cb?.name].filter(Boolean).join(" "),
      make: v.manufacturer_cb?.name ?? null,
      model: v.model_cb?.name ?? null,
      variant: v.model_variant ?? null,
      year,
      mileageKm: v.tachometer ?? null,
      price: v.price ?? null,
      currency: "CZK",
      fuel: v.fuel_cb?.name ?? null,
      transmission: v.gearbox_cb?.name ?? null,
      powerKw: v.power ?? null,
      body: v.body_cb?.name ?? null,
      color: v.color_cb?.name ?? null,
      location: v.locality?.district ?? null,
      country: "CZ",
      sellerType: v.seller_type === "S" || v.seller_type === "dealer" ? "dealer" : "private",
      vin: v.vin ?? null,
      imageUrls: (v.images ?? []).map((i) => i.url).filter((u): u is string => Boolean(u)),
    });
  }
  return out;
}

export const sautoAdapter: SourceAdapter = {
  id: "sauto",
  verified: false,
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
